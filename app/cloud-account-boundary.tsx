'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { cloudGenerationHeader, readCloudGenerationCookie } from '@/lib/cloud/account-fence';
import { createCloudSessionVerifier } from '@/lib/cloud/session-verification-scheduler';

/** The generation is a non-bearer stale-tab fence, never a grant or token. */
export function CloudAccountBoundary({ generation, children }: { generation: string | null; children: ReactNode }) {
  // Pin one document to its first SSR account. A client rerender must never
  // adopt a new account while old forms, media or recorder state can survive.
  const mountedGeneration = useRef(generation);
  const invalidated = useRef(false);
  useLayoutEffect(() => {
    const nativeFetch = window.fetch.bind(window);
    const pending = new Set<AbortController>();
    // Initial cookie mismatch may invalidate before the scheduler is created.
    let sessionVerifier: ReturnType<typeof createCloudSessionVerifier> | undefined = undefined;
    const current = () => readCloudGenerationCookie(document.cookie);
    const invalidate = () => {
      if (invalidated.current) return;
      invalidated.current = true;
      document.documentElement.style.visibility = 'hidden';
      pending.forEach(controller => controller.abort());
      sessionVerifier?.dispose();
      // Unload old account's components, media URLs and recorders, no SPA reuse.
      window.location.replace('/sign-in');
    };
    if (mountedGeneration.current !== generation) { invalidate(); return; }
    if (!generation) return;
    const check = () => { if (current() !== generation) invalidate(); };
    const guardedFetch: typeof fetch = async (input, options) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
      if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return nativeFetch(input, options);
      if (current() !== generation || invalidated.current) {
        invalidate(); throw new DOMException('Account changed', 'AbortError');
      }
      const requestHeaders = new Headers(options?.headers ?? (input instanceof Request ? input.headers : undefined));
      requestHeaders.set(cloudGenerationHeader, generation);
      const controller = new AbortController(); pending.add(controller);
      const parent = options?.signal ?? (input instanceof Request ? input.signal : undefined);
      const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
      try {
        const response = await nativeFetch(input, { ...options, headers: requestHeaders, signal });
        if (current() !== generation || invalidated.current) {
          invalidate(); throw new DOMException('Account changed', 'AbortError');
        }
        if (response.status === 401) invalidate();
        if (response.status === 409) {
          const result = await response.clone().json().catch(() => null) as { error?: { code?: string } } | null;
          if (result?.error?.code === 'SESSION_CHANGED') invalidate();
        }
        return response;
      } finally { pending.delete(controller); }
    };
    window.fetch = guardedFetch;
    check();
    const cookieInterval = window.setInterval(check, 300);
    const verify = async (signal: AbortSignal) => {
      if (document.visibilityState !== 'visible' || invalidated.current || signal.aborted) return;
      try {
        const response = await nativeFetch('/api/auth/cloud/session', { cache: 'no-store', redirect: 'error', signal });
        if (signal.aborted || invalidated.current) return;
        check();
        if (invalidated.current) return;
        if (response.status === 401) { invalidate(); return; }
        if (response.ok) {
          const result = await response.json() as { generation?: string };
          if (signal.aborted || invalidated.current) return;
          check();
          if (result.generation !== generation) invalidate();
        }
      } catch { /* Network failure is not an account change or an authority grant. */ }
    };
    sessionVerifier = createCloudSessionVerifier({ isVisible: () => document.visibilityState === 'visible',
      canVerify: () => !invalidated.current, verify });
    const focus = () => { check(); sessionVerifier?.wake(); };
    const visibility = () => {
      check();
      if (document.visibilityState === 'visible') sessionVerifier?.wake();
      else sessionVerifier?.pause();
    };
    // The SSR request just verified identity. Its first background cadence is
    // scheduled without another immediate duplicate provider request.
    sessionVerifier.start();
    const pageshow = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); else check(); };
    window.addEventListener('focus', focus); window.addEventListener('pageshow', pageshow);
    document.addEventListener?.('visibilitychange', visibility);
    return () => {
      window.clearInterval(cookieInterval); sessionVerifier?.dispose();
      window.removeEventListener('focus', focus); window.removeEventListener('pageshow', pageshow);
      document.removeEventListener?.('visibilitychange', visibility);
      pending.forEach(controller => controller.abort());
      if (window.fetch === guardedFetch) window.fetch = nativeFetch;
    };
  }, [generation]);
  return children;
}
