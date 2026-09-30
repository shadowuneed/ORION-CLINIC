/** Request scheduling only: no cached identity, permission or provider result. */
export const cloudSessionVerificationIntervalMs = 10_000;

type VerificationOptions = {
  isVisible: () => boolean;
  canVerify: () => boolean;
  verify: (signal: AbortSignal) => Promise<void>;
};

export function createCloudSessionVerifier(options: VerificationOptions) {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: AbortController | undefined;
  let lastStartedAt: number | undefined;
  let resumeQueued = false;
  let wasHidden = !options.isVisible();

  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const pause = () => {
    clearTimer(); resumeQueued = false; wasHidden = true; active?.abort();
  };
  const wake = () => {
    if (disposed || !options.canVerify()) { pause(); return; }
    if (!options.isVisible()) { pause(); return; }
    clearTimer();
    const resuming = wasHidden; wasHidden = false;
    if (active) {
      // A genuine hidden→visible transition must verify again once an aborted
      // prior request settles. Ordinary focus bursts share the active check.
      if (resuming && active.signal.aborted) resumeQueued = true;
      return;
    }
    const delay = resuming || lastStartedAt === undefined
      ? 0 : Math.max(0, cloudSessionVerificationIntervalMs - (Date.now() - lastStartedAt));
    if (delay > 0) { timer = setTimeout(wake, delay); return; }
    const controller = new AbortController(); active = controller; lastStartedAt = Date.now();
    void Promise.resolve().then(() => {
      if (!disposed && !controller.signal.aborted && options.isVisible() && options.canVerify()) return options.verify(controller.signal);
    }).catch(() => {
      // Unavailability never grants authority; the next visible cadence retries.
    }).finally(() => {
      if (active === controller) active = undefined;
      if (disposed || !options.isVisible() || !options.canVerify()) return;
      const immediate = resumeQueued; resumeQueued = false;
      if (immediate) { wasHidden = true; wake(); }
      else timer = setTimeout(wake, Math.max(0, cloudSessionVerificationIntervalMs - (Date.now() - (lastStartedAt ?? Date.now()))));
    });
  };
  const start = () => {
    if (disposed || lastStartedAt !== undefined) return;
    lastStartedAt = Date.now(); wake();
  };
  const dispose = () => { disposed = true; pause(); };
  return { start, wake, pause, dispose };
}
