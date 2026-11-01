import {createElement} from 'react';
import {renderToString} from 'react-dom/server';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {ClinicalRequestError} from './encounter-client';
import {clinicalLiveAnalysisContext,requestClinicalLiveAnalysis,liveAnalysisFault,useClinicalLiveAnalysis,type ClinicalLiveAnalysisOptions} from './live-analysis-client';
import {createLiveAnalysisScheduler} from './live-analysis-scheduler';
const options:ClinicalLiveAnalysisOptions={scopeKey:'clinic:doctor',encounterId:'encounter-a',enabled:true,canEdit:true,active:true,
  consent:{encounterId:'encounter-a',version:2,care:true,transcriptStorage:true,localAudioProcessing:true,externalAiProcessing:true},
  transcript:[{id:'segment-a',encounterId:'encounter-a',sequence:1,text:'Canonical saved speech. '.repeat(5)}]};
const ready={schemaVersion:1,status:'ready',encounterId:'encounter-a',summary:'Review suggestion',
  suggestions:[{id:'a'.repeat(32),category:'clarification',riskLevel:'informational',title:'Clarify the timeline',content:'Ask when this began.',evidence:[{sourceId:'segment-a',sequence:1,quote:'Canonical saved speech.'}]}],
  source:{revision:'b'.repeat(64),lastSequence:1,segmentIds:['segment-a'],analyzedSegments:1,totalSegments:1},generatedAt:'2026-10-07T10:00:00.000Z',cached:false,retryAfterMs:12000,reviewRequired:true};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
describe('canonical live-analysis browser boundary',()=>{
  it('requires active own care plus every canonical consent and ignores other encounter text',()=>{
    expect(clinicalLiveAnalysisContext(options)).toMatchObject({enabled:true,hasText:true});
    for(const gate of ['enabled','canEdit','active'] as const)expect(clinicalLiveAnalysisContext({...options,[gate]:false}).enabled).toBe(false);
    for(const gate of ['care','transcriptStorage','externalAiProcessing'] as const)expect(clinicalLiveAnalysisContext({...options,consent:{...options.consent!,[gate]:false}}).enabled).toBe(false);
    // Previously stored speech remains eligible for text analysis after the
    // patient stops/revokes local audio processing; external AI consent is still required.
    expect(clinicalLiveAnalysisContext({...options,consent:{...options.consent!,localAudioProcessing:false}}).enabled).toBe(true);
    expect(clinicalLiveAnalysisContext({...options,consent:{...options.consent!,localAudioProcessing:false,externalAiProcessing:false}}).enabled).toBe(false);
    expect(clinicalLiveAnalysisContext({...options,consent:null}).enabled).toBe(false);
    expect(clinicalLiveAnalysisContext({...options,consent:{...options.consent!,encounterId:'other'}}).enabled).toBe(false);
    expect(clinicalLiveAnalysisContext({...options,transcript:[{...options.transcript[0],encounterId:'other'}]})).toMatchObject({hasText:false,transcriptKey:'[]'});
  });
  it('uses canonical IDs once in stable sequence order and fences a consent revision change',()=>{
    const first=options.transcript[0];const second={...first,id:'segment-b',sequence:2,text:'Second recorded segment.'};
    const a=clinicalLiveAnalysisContext({...options,transcript:[second,first,first]});
    const b=clinicalLiveAnalysisContext({...options,transcript:[first,second]});expect(a.transcriptKey).toBe(b.transcriptKey);
    expect(a.transcriptKey).not.toContain('Canonical');
    expect(clinicalLiveAnalysisContext({...options,consent:{...options.consent!,version:3}}).scopeKey).not.toBe(a.scopeKey);
    expect(clinicalLiveAnalysisContext({...options,transcript:[{...first,text:'Short.'}]}).hasText).toBe(false);
  });
  it('posts only the encounter ID and never drafts, transcript text, or note commands',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(ready),{status:200}));vi.stubGlobal('fetch',fetcher);
    const controller=new AbortController();expect(await requestClinicalLiveAnalysis('encounter-a',controller.signal)).toEqual(ready);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/clinical/v1/analysis/live',expect.objectContaining({method:'POST',body:'{"encounterId":"encounter-a"}',cache:'no-store',signal:expect.any(AbortSignal)}));
    expect(fetcher.mock.calls[0][1].body).not.toContain('speech');
  });
  it('rejects incompatible/foreign ready responses rather than displaying their hints',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({...ready,encounterId:'other-encounter'}),{status:200})));
    await expect(requestClinicalLiveAnalysis('encounter-a',new AbortController().signal)).rejects.toMatchObject({code:'INVALID_ANALYSIS_CONTEXT',status:502});
  });
  it('bounds Retry-After and treats server consent/identity failures as protected-data invalidation',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{code:'ANALYSIS_RATE_LIMITED',message:'Wait before retrying'}}),{status:429,headers:{'Retry-After':'999'}})));
    let failure:unknown;try{await requestClinicalLiveAnalysis('encounter-a',new AbortController().signal);}catch(error){failure=error;}
    expect(liveAnalysisFault(failure)).toMatchObject({status:429,retryAfterMs:60000,clearData:false});
    expect(liveAnalysisFault(new ClinicalRequestError('Consent revoked','AI_CONSENT_REQUIRED',409)).clearData).toBe(true);
    expect(liveAnalysisFault(new ClinicalRequestError('Forbidden','FORBIDDEN',403)).clearData).toBe(true);
  });
  it('does not create requests or analysis timers during server rendering',()=>{
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
    const timer=vi.spyOn(globalThis,'setTimeout');
    function Preview(){const state=useClinicalLiveAnalysis(options);return createElement('span',null,state.status);}
    expect(renderToString(createElement(Preview))).toContain('idle');expect(fetcher).not.toHaveBeenCalled();expect(timer).not.toHaveBeenCalled();
  });
  it('releases a hung request after 45 seconds and requires manual retry for unchanged saved context',async()=>{
    vi.useFakeTimers();vi.setSystemTime(0);
    const fetcher=vi.fn().mockImplementation(()=>new Promise(()=>{}));vi.stubGlobal('fetch',fetcher);
    const scheduler=createLiveAnalysisScheduler({request:async(encounterId,signal)=>{const result=await requestClinicalLiveAnalysis(encounterId,signal);return result.status==='ready'?{status:'ready',data:result}:{status:'waiting',reason:result.reason,retryAfterMs:result.retryAfterMs};},fault:liveAnalysisFault,onChange:()=>{}});
    scheduler.update(clinicalLiveAnalysisContext(options));await vi.advanceTimersByTimeAsync(3000);expect(fetcher).toHaveBeenCalledTimes(1);
    const firstSignal=fetcher.mock.calls[0][1].signal as AbortSignal;
    await vi.advanceTimersByTimeAsync(44999);expect(scheduler.snapshot().status).toBe('analyzing');
    await vi.advanceTimersByTimeAsync(1);expect(firstSignal.aborted).toBe(true);expect(scheduler.snapshot()).toMatchObject({status:'error',error:expect.stringContaining('45 секунд')});
    await vi.advanceTimersByTimeAsync(600000);expect(fetcher).toHaveBeenCalledTimes(1);
    scheduler.refresh();await vi.advanceTimersByTimeAsync(0);expect(fetcher).toHaveBeenCalledTimes(2);
    scheduler.dispose();await vi.advanceTimersByTimeAsync(0);expect((fetcher.mock.calls[1][1].signal as AbortSignal).aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels the deadline immediately when its caller aborts even if transport ignores cancellation',async()=>{
    vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>new Promise(()=>{})));
    const controller=new AbortController();const result=requestClinicalLiveAnalysis('encounter-a',controller.signal);
    const rejected=expect(result).rejects.toMatchObject({name:'AbortError'});controller.abort();await rejected;expect(vi.getTimerCount()).toBe(0);
  });
});
