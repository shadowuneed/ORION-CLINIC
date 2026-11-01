'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import type {ClinicalSnapshot} from './contracts';
import {clinicalJson,ClinicalRequestError} from './encounter-client';
import {liveAnalysisRequestSchema,liveAnalysisResponseSchema,LIVE_ANALYSIS_MIN_CHARACTERS,LIVE_ANALYSIS_INTERVAL_MS,type LiveAnalysisResponse} from './live-analysis';
import {createLiveAnalysisScheduler,emptyLiveAnalysisState,liveAnalysisScope,type LiveAnalysisContext,type LiveAnalysisFault,type LiveAnalysisState} from './live-analysis-scheduler';

export type ClinicalLiveAnalysisReady = Extract<LiveAnalysisResponse,{status:'ready'}>;
export type ClinicalLiveAnalysisOptions = {
  /** Clinic + authenticated practitioner identity; never a patient's name. */
  scopeKey:string;
  encounterId:string|null;
  enabled:boolean;
  canEdit:boolean;
  active:boolean;
  consent:ClinicalSnapshot['consents'][number]|null|undefined;
  transcript:readonly Pick<ClinicalSnapshot['transcript'][number],'id'|'encounterId'|'sequence'|'text'>[];
};
class LiveAnalysisRequestError extends ClinicalRequestError {
  constructor(message:string,code:string,status:number,readonly retryAfterMs:number){super(message,code,status);}
}
function retryAfter(response:Response){
  const raw=response.headers.get('Retry-After');if(!raw)return 0;
  const seconds=Number(raw);const milliseconds=Number.isFinite(seconds)?seconds*1000:Date.parse(raw)-Date.now();
  return Number.isFinite(milliseconds)?Math.min(60000,Math.max(0,milliseconds)):0;
}
export function liveAnalysisFault(error:unknown):LiveAnalysisFault {
  if(error instanceof ClinicalRequestError)return {
    message:error.message,status:error.status,code:error.code,
    retryAfterMs:error instanceof LiveAnalysisRequestError?error.retryAfterMs:0,
    clearData:error.status===401||error.status===403||['AI_CONSENT_REQUIRED','ANALYSIS_CONTEXT_CHANGED'].includes(error.code),
  };
  return {message:'Не удалось обновить подсказки ИИ. Запись разговора сохранена; можно повторить анализ.'};
}
export async function requestClinicalLiveAnalysis(encounterId:string,signal:AbortSignal):Promise<LiveAnalysisResponse> {
  const body=liveAnalysisRequestSchema.parse({encounterId});
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;let onAbort=()=>{};
  const deadline=new Promise<never>((_resolve,reject)=>{
    onAbort=()=>{controller.abort();reject(new DOMException('Aborted','AbortError'));};
    signal.addEventListener('abort',onAbort,{once:true});
    timer=setTimeout(()=>{controller.abort();reject(new ClinicalRequestError('Анализ ИИ не ответил за 45 секунд. Запись сохранена; повторите запрос вручную.','ANALYSIS_TIMEOUT',504));},45000);
  });
  try{
    const request=async()=>{
      const response=await fetch('/api/clinical/v1/analysis/live',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal:controller.signal});
      let value:unknown;
      try{value=await clinicalJson(response);}catch(error){
        if(error instanceof ClinicalRequestError)throw new LiveAnalysisRequestError(error.message,error.code,error.status,retryAfter(response));
        throw error;
      }
      const parsed=liveAnalysisResponseSchema.safeParse(value);
      if(!parsed.success||parsed.data.encounterId!==encounterId)throw new ClinicalRequestError('Ответ ИИ относится к несовместимому контексту. Повторите анализ.','INVALID_ANALYSIS_CONTEXT',502);
      return parsed.data;
    };
    // Race also bounds a transport/body reader that ignores AbortSignal.
    return await Promise.race([request(),deadline]);
  }finally{if(timer!==undefined)clearTimeout(timer);signal.removeEventListener('abort',onAbort);}
}
export function clinicalLiveAnalysisContext(options:ClinicalLiveAnalysisOptions):LiveAnalysisContext {
  const id=options.encounterId??'';const consent=options.consent;
  const rows=options.transcript.filter(row=>row.encounterId===id).slice().sort((a,b)=>a.sequence-b.sequence||a.id.localeCompare(b.id));
  const seen=new Set<string>();const unique=rows.filter(row=>{if(seen.has(row.id))return false;seen.add(row.id);return true;});
  return {
    scopeKey:JSON.stringify([options.scopeKey,consent?.encounterId===id?consent.version:null]),encounterId:id,
    enabled:Boolean(options.enabled&&options.canEdit&&options.active&&id&&consent?.encounterId===id&&consent.care&&consent.transcriptStorage&&consent.externalAiProcessing),
    transcriptKey:JSON.stringify(unique.map(row=>[row.id,row.sequence])),
    hasText:unique.reduce((total,row)=>total+row.text.trim().length,0)>=LIVE_ANALYSIS_MIN_CHARACTERS,
  };
}
export function useClinicalLiveAnalysis(options:ClinicalLiveAnalysisOptions){
  const context=clinicalLiveAnalysisContext(options);const scope=liveAnalysisScope(context);
  const [state,setState]=useState<LiveAnalysisState<ClinicalLiveAnalysisReady>>(()=>emptyLiveAnalysisState());
  const scheduler=useRef<ReturnType<typeof createLiveAnalysisScheduler<ClinicalLiveAnalysisReady>>|null>(null);
  useEffect(()=>{
    const instance=createLiveAnalysisScheduler<ClinicalLiveAnalysisReady>({
      intervalMs:LIVE_ANALYSIS_INTERVAL_MS,
      request:async(encounterId,signal)=>{
        const result=await requestClinicalLiveAnalysis(encounterId,signal);
        return result.status==='ready'?{status:'ready',data:result}:{status:'waiting',reason:result.reason,retryAfterMs:result.retryAfterMs};
      },
      fault:liveAnalysisFault,onChange:setState,
    });
    scheduler.current=instance;
    return()=>{instance.dispose();if(scheduler.current===instance)scheduler.current=null;};
  },[]);
  useEffect(()=>{
    scheduler.current?.update({scopeKey:context.scopeKey,encounterId:context.encounterId,enabled:context.enabled,transcriptKey:context.transcriptKey,hasText:context.hasText});
  },[context.scopeKey,context.encounterId,context.enabled,context.transcriptKey,context.hasText]);
  const refresh=useCallback(()=>scheduler.current?.refresh(),[]);
  const clear=useCallback(()=>scheduler.current?.clear(),[]);
  // Do not wait for an effect to erase another identity's hints after navigation
  // or consent revocation. SSR has no effects, timers, or network requests.
  const visible=context.enabled&&state.scope===scope?state:emptyLiveAnalysisState<ClinicalLiveAnalysisReady>(scope,context.enabled?'idle':'disabled');
  const latestSequence=options.transcript.reduce((latest,row)=>row.encounterId===options.encounterId?Math.max(latest,row.sequence):latest,0);
  return {...visible,isStale:visible.isStale||Boolean(visible.data&&visible.data.source.lastSequence<latestSequence),refresh,clear};
}
