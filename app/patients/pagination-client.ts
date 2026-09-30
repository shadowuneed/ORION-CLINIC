import type { PatientContinuationPage } from '@/lib/repositories/patient-registry';

/** A response can publish only in the request's original context and account. */
export function createPatientRequestFence(readAccount: () => string | null = () => null) {
  let generation = 0;
  const pending = new Map<string, AbortController>();
  return {
    retire() {
      generation += 1;
      pending.forEach(controller => controller.abort());
      pending.clear();
    },
    begin(channel: string) {
      pending.get(channel)?.abort();
      const controller = new AbortController();
      pending.set(channel, controller);
      const observedGeneration = generation;
      const account = readAccount();
      return {
        signal: controller.signal,
        current: () => !controller.signal.aborted && generation === observedGeneration &&
          pending.get(channel) === controller && account === readAccount(),
          finish: () => { if (pending.get(channel) === controller) pending.delete(channel); },
          cancel: () => { controller.abort(); if (pending.get(channel) === controller) pending.delete(channel); },
      };
    },
  };
}

/** Keep previously displayed rows, replacing a repeated identity in place. */
export function appendPatientRows<T extends { id: string }>(current: readonly T[], next: readonly T[]): T[] {
  const result = [...current];
  const positions = new Map(result.map((row, index) => [row.id, index]));
  for (const row of next) {
    const position = positions.get(row.id);
    if (position === undefined) {
      positions.set(row.id, result.length);
      result.push(row);
    } else result[position] = row;
  }
  return result;
}

export function isPatientContinuationPage(value: unknown): value is PatientContinuationPage {
  if (!value || typeof value !== 'object') return false;
  const page = value as Partial<PatientContinuationPage>;
  return typeof page.hasMore === 'boolean' &&
      (page.hasMore ? typeof page.nextCursor === 'string' && page.nextCursor.length > 0 && page.nextCursor.length <= 2048 : page.nextCursor === null);
}
