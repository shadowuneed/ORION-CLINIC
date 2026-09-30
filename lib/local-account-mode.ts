// Replaced by the loopback-only Vite serving configuration. Production builds
// never enable the local identity transport or disable their normal auth gate.
declare const __ORION_LOCAL_CREDENTIALS__: boolean;

export function localAccountModeEnabled(): boolean {
  return typeof __ORION_LOCAL_CREDENTIALS__ !== 'undefined' && __ORION_LOCAL_CREDENTIALS__ === true;
}

export const localSessionGenerationCookie = 'orion_local_generation';
export const localSessionGenerationHeader = 'x-orion-local-generation';
