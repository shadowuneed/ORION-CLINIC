/** Browser-independent scheduler; no transcript text or clinical mutations. */
export type LiveAnalysisStatus = 'disabled' | 'idle' | 'waiting' | 'analyzing' | 'ready' | 'error';
export type LiveAnalysisContext = { scopeKey: string; encounterId: string; enabled: boolean; transcriptKey: string; hasText: boolean };
export type LiveAnalysisWaitingReason = 'more_text' | 'cooldown' | 'busy';
export type LiveAnalysisOutcome<T> = { status: 'ready'; data: T } | { status: 'waiting'; reason: LiveAnalysisWaitingReason; retryAfterMs: number };
export type LiveAnalysisFault = { message: string; status?: number; code?: string; retryAfterMs?: number; clearData?: boolean };
export type LiveAnalysisState<T> = {
  scope: string; status: LiveAnalysisStatus; data: T | null; error: string | null;
  retryAt: number | null; isStale: boolean; waitingReason: LiveAnalysisWaitingReason | null;
};
type Clock = { now(): number; set(callback: () => void, delay: number): unknown; clear(timer: unknown): void };
const browserClock: Clock = { now: ()=>Date.now(), set: (callback,delay)=>setTimeout(callback,delay), clear: timer=>clearTimeout(timer as ReturnType<typeof setTimeout>) };
export function emptyLiveAnalysisState<T>(scope='',status:LiveAnalysisStatus='disabled'): LiveAnalysisState<T> {
  return { scope,status,data:null,error:null,retryAt:null,isStale:false,waitingReason:null };
}
export function liveAnalysisScope(context: Pick<LiveAnalysisContext,'scopeKey'|'encounterId'>) { return JSON.stringify([context.scopeKey,context.encounterId]); }
const boundedDelay=(value:number|undefined)=>Number.isFinite(value)?Math.min(60000,Math.max(0,value!)):0;

export function createLiveAnalysisScheduler<T>(options: {
  request(encounterId:string,signal:AbortSignal):Promise<LiveAnalysisOutcome<T>>;
  onChange(state:LiveAnalysisState<T>):void;
  fault(error:unknown):LiveAnalysisFault;
  clock?:Clock; quietMs?:number; intervalMs?:number;
}) {
  const clock=options.clock??browserClock;const quietMs=options.quietMs??3000;const interval=options.intervalMs??12000;
  let context:LiveAnalysisContext|null=null;let state=emptyLiveAnalysisState<T>();let dataKey:string|null=null;
  let timer:unknown;let flight:{controller:AbortController;generation:number;key:string}|null=null;
  let generation=0;let disposed=false;let quietAt=0;let lastStart=-Infinity;let blockedUntil=0;let failures=0;
  let forceKey:string|null=null;let serverBlocked=false;const attempted=new Set<string>();const retriedWaiting=new Set<string>();
  const cancelTimer=()=>{if(timer!==undefined){clock.clear(timer);timer=undefined;}};
  const emit=(patch:Partial<LiveAnalysisState<T>>={})=>{
    if(disposed)return;
    state={...state,...patch};state.isStale=state.data!==null&&dataKey!==context?.transcriptKey;
    options.onChange({...state});
  };
  function invalidate(){generation++;cancelTimer();flight?.controller.abort();flight=null;}
  function pump(){
    cancelTimer();if(disposed||!context)return;
    if(!context.enabled){emit({status:'disabled',data:null,error:null,retryAt:null,waitingReason:null});return;}
    if(serverBlocked){emit({status:'error',retryAt:null});return;}
    if(!context.hasText||!context.transcriptKey){emit({status:'idle',retryAt:null,waitingReason:'more_text'});return;}
    if(flight){emit({status:'analyzing',retryAt:null});return;}
    if(attempted.has(context.transcriptKey)&&forceKey!==context.transcriptKey){
      emit({status:state.error?'error':state.waitingReason?'waiting':state.data?'ready':'idle'});return;
    }
    const due=Math.max(quietAt,lastStart+interval,blockedUntil);
    if(due>clock.now()){
      emit({status:'waiting',retryAt:due});timer=clock.set(pump,due-clock.now());return;
    }
    const run={controller:new AbortController(),generation,key:context.transcriptKey};const encounterId=context.encounterId;
    flight=run;forceKey=null;attempted.add(run.key);lastStart=clock.now();
    emit({status:'analyzing',error:null,retryAt:null,waitingReason:null});
    void Promise.resolve().then(()=>options.request(encounterId,run.controller.signal)).then(result=>{
      if(disposed||flight!==run||run.generation!==generation||!context?.enabled)return;
      flight=null;
      if(result.status==='ready'){
        dataKey=run.key;failures=0;blockedUntil=0;
        emit({status:'ready',data:result.data,error:null,retryAt:null,waitingReason:null});
      }else{
        blockedUntil=Math.max(blockedUntil,clock.now()+boundedDelay(result.retryAfterMs));
        emit({status:'waiting',waitingReason:result.reason,retryAt:result.reason==='more_text'?null:blockedUntil});
        // A busy/cooldown response is not a result. Allow one bounded retry;
        // never poll unchanged context forever or repeat insufficient text.
        if(result.reason!=='more_text'&&!retriedWaiting.has(run.key)&&context.transcriptKey===run.key){
          retriedWaiting.add(run.key);forceKey=run.key;quietAt=clock.now();
        }
      }
      pump();
    }).catch(error=>{
      if(disposed||flight!==run||run.generation!==generation||run.controller.signal.aborted)return;
      flight=null;const fault=options.fault(error);failures++;
      blockedUntil=Math.max(blockedUntil,clock.now()+Math.max(Math.min(60000,interval*2**Math.min(failures-1,4)),boundedDelay(fault.retryAfterMs)));
      if(fault.clearData){dataKey=null;serverBlocked=true;}
      emit({status:'error',error:fault.message,retryAt:blockedUntil,waitingReason:null,...(fault.clearData?{data:null}:{})});
      // A changed canonical context can be analyzed after backoff. An unchanged
      // failed context requires the clinician's explicit refresh.
      pump();
    });
  }
  return {
    update(next:LiveAnalysisContext){
      if(disposed)return;
      const scope=liveAnalysisScope(next);const changedScope=scope!==state.scope;const changedText=next.transcriptKey!==context?.transcriptKey;
      if(changedScope){invalidate();attempted.clear();retriedWaiting.clear();forceKey=null;serverBlocked=false;dataKey=null;failures=0;state=emptyLiveAnalysisState<T>(scope);}
      if(!next.enabled){invalidate();forceKey=null;dataKey=null;state=emptyLiveAnalysisState<T>(scope);}
      context={...next};
      if(changedScope||changedText)quietAt=clock.now()+quietMs;
      if(changedText)state={...state,error:null,waitingReason:null};
      pump();
    },
    refresh(){if(disposed||!context?.enabled||!context.hasText)return;serverBlocked=false;forceKey=context.transcriptKey;quietAt=clock.now();pump();},
    clear(){if(disposed)return;invalidate();forceKey=null;dataKey=null;state=emptyLiveAnalysisState<T>(state.scope,context?.enabled?'idle':'disabled');emit();},
    dispose(){if(disposed)return;disposed=true;invalidate();},
    snapshot(){return {...state};},
  };
}
