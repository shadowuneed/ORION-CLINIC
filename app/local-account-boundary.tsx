'use client';

import { useLayoutEffect, type ReactNode } from 'react';
import { localAccountModeEnabled, localSessionGenerationCookie, localSessionGenerationHeader } from '@/lib/local-account-mode';

/** The generation is a non-bearer session fence, never a credential or grant. */
export function LocalAccountBoundary({ generation, children }: { generation: string | null; children: ReactNode }) {
  useLayoutEffect(() => {
    if (!localAccountModeEnabled() || !generation) return;
    const nativeFetch = window.fetch.bind(window);
    const pending = new Set<AbortController>();
    let invalidated = false;
    const current = () => document.cookie.split(';').map(item=>item.trim())
      .find(item=>item.startsWith(`${localSessionGenerationCookie}=`))?.slice(localSessionGenerationCookie.length+1);
    const invalidate = () => {
      if (invalidated) return;
      invalidated=true;
      // Hide the previous account's view synchronously, then unload all recorders,
      // audio URLs and component state through a full document navigation.
      document.documentElement.style.visibility='hidden';
      pending.forEach(controller=>controller.abort());
      window.location.replace('/sign-in');
    };
    const check = () => { if (current()!==generation) invalidate(); };
    const guardedFetch: typeof fetch = async (input, options) => {
      const url=new URL(input instanceof Request ? input.url : String(input),window.location.href);
      if(url.origin!==window.location.origin || !url.pathname.startsWith('/api/')) return nativeFetch(input,options);
      if(current()!==generation || invalidated) { invalidate();throw new DOMException('Account changed','AbortError'); }
      const headers=new Headers(options?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set(localSessionGenerationHeader,generation);
      const controller=new AbortController();pending.add(controller);
      const parentSignal=options?.signal ?? (input instanceof Request ? input.signal : undefined);
      const signal=parentSignal ? AbortSignal.any([parentSignal,controller.signal]) : controller.signal;
      try {
        const response=await nativeFetch(input,{...options,headers,signal});
        if(current()!==generation || invalidated) { invalidate();throw new DOMException('Account changed','AbortError'); }
        if(response.status===401) invalidate();
        if(response.status===409) {
          const body=await response.clone().json().catch(()=>null) as {error?:{code?:string}}|null;
          if(body?.error?.code==='SESSION_CHANGED') invalidate();
        }
        return response;
      } finally { pending.delete(controller); }
    };
    window.fetch=guardedFetch;
    check();
    const interval=window.setInterval(check,300);
    const verify=async () => {
      if(document.visibilityState!=='visible' || invalidated) return;
      try {
        const response=await nativeFetch('/api/local-account/session',{cache:'no-store'});
        if(response.status===401) { invalidate();return; }
        if(response.ok && (await response.json() as {generation:string}).generation!==generation) invalidate();
      } catch { /* A transient network failure does not change the account. */ }
    };
    const sessionInterval=window.setInterval(()=>void verify(),10000);
    const focus=()=>{check();void verify();};
    const pageshow=(event:PageTransitionEvent)=>{if(event.persisted)window.location.reload();else check();};
    window.addEventListener('focus',focus);window.addEventListener('pageshow',pageshow);
    return () => { window.clearInterval(interval);window.clearInterval(sessionInterval);window.removeEventListener('focus',focus);window.removeEventListener('pageshow',pageshow);pending.forEach(controller=>controller.abort());if(window.fetch===guardedFetch)window.fetch=nativeFetch; };
  },[generation]);
  return children;
}
