import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {createLiveAnalysisScheduler,type LiveAnalysisContext,type LiveAnalysisOutcome,type LiveAnalysisFault} from './live-analysis-scheduler';
const initial:LiveAnalysisContext={scopeKey:'clinic:doctor',encounterId:'encounter-a',enabled:true,transcriptKey:'segment-1',hasText:true};
const ready=(value='readonly hint'):LiveAnalysisOutcome<string>=>({status:'ready',data:value});
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(value:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function setup(){const request=vi.fn<(id:string,signal:AbortSignal)=>Promise<LiveAnalysisOutcome<string>>>().mockResolvedValue(ready());const onChange=vi.fn();const scheduler=createLiveAnalysisScheduler<string>({request,onChange,fault:error=>error as LiveAnalysisFault});return{request,onChange,scheduler};}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(0);});
afterEach(()=>{vi.useRealTimers();});
describe('bounded live-analysis scheduler',()=>{
  it('waits for three seconds of quiet and ignores repeated snapshots of unchanged canonical IDs',async()=>{
    const {scheduler,request}=setup();scheduler.update(initial);await vi.advanceTimersByTimeAsync(2000);
    scheduler.update({...initial,transcriptKey:'segment-1,segment-2'});await vi.advanceTimersByTimeAsync(2999);expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0][0]).toBe('encounter-a');
    for(let index=0;index<5;index++){scheduler.update({...initial,transcriptKey:'segment-1,segment-2'});await vi.advanceTimersByTimeAsync(60000);}
    expect(request).toHaveBeenCalledTimes(1);expect(scheduler.snapshot()).toMatchObject({status:'ready',data:'readonly hint',isStale:false});scheduler.dispose();
  });
  it('coalesces text arriving during one request and keeps 12-second spacing from request start',async()=>{
    const {scheduler,request}=setup();const first=deferred<LiveAnalysisOutcome<string>>();request.mockReturnValueOnce(first.promise);
    scheduler.update(initial);await vi.advanceTimersByTimeAsync(3000);expect(request).toHaveBeenCalledTimes(1);
    scheduler.update({...initial,transcriptKey:'segment-2'});await vi.advanceTimersByTimeAsync(1000);scheduler.update({...initial,transcriptKey:'segment-3'});
    first.resolve(ready('older hint'));await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.snapshot()).toMatchObject({status:'waiting',data:'older hint',isStale:true});
    await vi.advanceTimersByTimeAsync(10999);expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);expect(request).toHaveBeenCalledTimes(2);expect(scheduler.snapshot().isStale).toBe(false);scheduler.dispose();
  });
  it('does not retry unchanged errors automatically; manual retries honor backoff and Retry-After',async()=>{
    const {scheduler,request}=setup();request.mockRejectedValue({message:'Rate limited',status:429,retryAfterMs:60000});
    scheduler.update(initial);await vi.advanceTimersByTimeAsync(3000);expect(scheduler.snapshot()).toMatchObject({status:'error',error:'Rate limited',retryAt:63000});
    scheduler.refresh();await vi.advanceTimersByTimeAsync(59999);expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(600000);expect(request).toHaveBeenCalledTimes(2);scheduler.dispose();
  });
  it('backs off new contexts after repeated 503 responses up to sixty seconds',async()=>{
    const {scheduler,request}=setup();request.mockRejectedValue({message:'Unavailable',status:503});
    scheduler.update(initial);await vi.advanceTimersByTimeAsync(3000);
    for(const [index,delay] of [12000,24000,48000,60000,60000].entries()){
      scheduler.update({...initial,transcriptKey:'new-'+index});await vi.advanceTimersByTimeAsync(delay-1);expect(request).toHaveBeenCalledTimes(index+1);
      await vi.advanceTimersByTimeAsync(1);expect(request).toHaveBeenCalledTimes(index+2);
    }
    await vi.advanceTimersByTimeAsync(600000);expect(request).toHaveBeenCalledTimes(6);scheduler.dispose();
  });
  it('aborts and fences late responses on identity/encounter change, consent revocation and unmount',async()=>{
    const {scheduler,request,onChange}=setup();const first=deferred<LiveAnalysisOutcome<string>>();request.mockReturnValueOnce(first.promise);
    scheduler.update(initial);await vi.advanceTimersByTimeAsync(3000);const signal=request.mock.calls[0][1];
    scheduler.update({...initial,scopeKey:'other-doctor',encounterId:'encounter-b'});expect(signal.aborted).toBe(true);
    first.resolve(ready('must never escape old scope'));await vi.advanceTimersByTimeAsync(0);expect(scheduler.snapshot().data).toBeNull();
    await vi.advanceTimersByTimeAsync(12000);expect(request).toHaveBeenCalledTimes(2);
    scheduler.update({...initial,scopeKey:'other-doctor',encounterId:'encounter-b',enabled:false});expect(scheduler.snapshot()).toMatchObject({status:'disabled',data:null});
    const count=onChange.mock.calls.length;scheduler.dispose();await vi.advanceTimersByTimeAsync(60000);expect(onChange).toHaveBeenCalledTimes(count);
  });
  it('allows only one cooldown/busy retry and never polls a more-text response',async()=>{
    const {scheduler,request}=setup();request.mockResolvedValue({status:'waiting',reason:'busy',retryAfterMs:12000});
    scheduler.update(initial);await vi.advanceTimersByTimeAsync(3000);await vi.advanceTimersByTimeAsync(12000);expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(600000);expect(request).toHaveBeenCalledTimes(2);
    request.mockResolvedValue({status:'waiting',reason:'more_text',retryAfterMs:0});scheduler.update({...initial,transcriptKey:'new-segment'});
    await vi.advanceTimersByTimeAsync(3000);await vi.advanceTimersByTimeAsync(600000);expect(request).toHaveBeenCalledTimes(3);scheduler.dispose();
  });
  it('clears protected hints on server permission rejection and blocks new IDs until renewed scope or manual retry',async()=>{
    const {scheduler,request}=setup();scheduler.update(initial);await vi.advanceTimersByTimeAsync(3000);
    request.mockRejectedValue({message:'Consent revoked',status:409,clearData:true});scheduler.update({...initial,transcriptKey:'new'});await vi.advanceTimersByTimeAsync(12000);
    expect(scheduler.snapshot()).toMatchObject({status:'error',data:null,error:'Consent revoked'});
    scheduler.update({...initial,transcriptKey:'newer'});await vi.advanceTimersByTimeAsync(60000);expect(request).toHaveBeenCalledTimes(2);
    request.mockResolvedValue(ready('renewed'));scheduler.update({...initial,scopeKey:'clinic:doctor:renewed-consent',transcriptKey:'newer'});await vi.advanceTimersByTimeAsync(3000);
    expect(scheduler.snapshot().data).toBe('renewed');scheduler.dispose();
  });
  it('does not send disabled/insufficient context and clear never invents a retry',async()=>{
    const {scheduler,request}=setup();scheduler.update({...initial,enabled:false});await vi.advanceTimersByTimeAsync(60000);
    scheduler.update({...initial,hasText:false});scheduler.refresh();await vi.advanceTimersByTimeAsync(60000);expect(request).not.toHaveBeenCalled();
    scheduler.update(initial);await vi.advanceTimersByTimeAsync(0);expect(request).toHaveBeenCalledTimes(1);
    scheduler.clear();scheduler.update(initial);await vi.advanceTimersByTimeAsync(60000);expect(request).toHaveBeenCalledTimes(1);expect(scheduler.snapshot().data).toBeNull();scheduler.dispose();
  });
});
