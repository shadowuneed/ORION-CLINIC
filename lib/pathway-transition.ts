export const PATHWAY_NAVIGATION_EVENT = 'orion:pathway-navigation';

export type PathwayNavigation = { from: string; target: string; label: string };
export type PathwayTransition = PathwayNavigation & {
  direction: 'open' | 'close';
  phase: 'cover' | 'waiting' | 'reveal';
};

export const pathwayMotionDuration = {
  open: { cover: 500, reveal: 420 },
  close: { cover: 360, reveal: 400 },
  timeout: 12_000,
} as const;

/** Delays only the pathway boundary. The curtain survives the actual page commit. */
export function createPathwayTransitionController(options: {
  navigate: (target: string) => void;
  publish: (transition: PathwayTransition | null) => void;
  settled: (outcome: 'ready' | 'cancelled' | 'failed', request: PathwayNavigation) => void;
  schedule?: (callback: () => void, delay: number) => () => void;
}) {
  const schedule = options.schedule ?? ((callback, delay) => {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  });
  let current: PathwayTransition | null = null;
  let cancelTimer: (() => void) | undefined;

  function finish(outcome: 'ready' | 'cancelled' | 'failed') {
    cancelTimer?.();
    cancelTimer = undefined;
    const request = current;
    current = null;
    options.publish(null);
    if (request) options.settled(outcome, request);
  }

  return {
    start(request: PathwayNavigation) {
      if (current) return;
      const direction = request.from === '/pathway' ? 'close' : 'open';
      current = { ...request, direction, phase: 'cover' };
      options.publish(current);
      cancelTimer = schedule(() => {
        if (!current) return;
        current = { ...current, phase: 'waiting' };
        options.publish(current);
        cancelTimer = schedule(() => finish('failed'), pathwayMotionDuration.timeout);
        try { options.navigate(request.target); }
        catch { finish('failed'); }
      }, pathwayMotionDuration[direction].cover);
    },
    ready(pathname: string) {
      if (!current || pathname === current.from) return;
      if (current.phase === 'cover') {
        // Back/forward or another navigation won before our push; never push the stale target.
        finish('cancelled');
        return;
      }
      if (current.phase !== 'waiting') return;
      cancelTimer?.();
      current = { ...current, phase: 'reveal' };
      options.publish(current);
      cancelTimer = schedule(() => finish('ready'), pathwayMotionDuration[current.direction].reveal);
    },
    cancel() { finish('cancelled'); },
    reduceMotion() {
      const request = current;
      finish('cancelled');
      if (request?.phase === 'cover') {
        try { options.navigate(request.target); }
        catch { options.settled('failed', request); }
      }
    },
    dispose() { cancelTimer?.(); current = null; },
  };
}
