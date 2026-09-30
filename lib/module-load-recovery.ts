/** Only module-loading failures; ordinary API/network/application errors remain visible. */
export function isModuleLoadFailure(reason: unknown): boolean {
  let message: unknown;
  try {
    message = typeof reason === 'string' ? reason : reason && typeof reason === 'object' && 'message' in reason ? reason.message : null;
  } catch { return false; }
  return typeof message === 'string' && /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk [\w-]+ failed/i.test(message);
}

/** Offer recovery, never auto-reload: the current encounter may have unsaved text/audio. */
export function listenForModuleLoadFailure(target: EventTarget, onFailure: () => void) {
  const rejectionOptions = { capture: true };
  const reject = (event: Event) => {
    if (!isModuleLoadFailure((event as PromiseRejectionEvent).reason)) return;
    event.preventDefault();
    // Keep the dev overlay/hard-navigation fallback from hiding the recovery UI
    // or discarding an in-progress note. Other error kinds are not intercepted.
    event.stopImmediatePropagation();
    onFailure();
  };
  const preload = (event: Event) => {
    if (!isModuleLoadFailure((event as Event & { payload?: unknown }).payload)) return;
    event.preventDefault();
    onFailure();
  };
  target.addEventListener('unhandledrejection', reject, rejectionOptions);
  target.addEventListener('vite:preloadError', preload);
  return () => {
    target.removeEventListener('unhandledrejection', reject, rejectionOptions);
    target.removeEventListener('vite:preloadError', preload);
  };
}
