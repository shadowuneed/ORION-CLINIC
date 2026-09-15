import type { OrionEncounterRecord } from './encounter-history';

/** Local material lifecycle is not the authoritative clinical encounter status. */
export function localMaterialStatus(record: Pick<OrionEncounterRecord,
  'status' | 'transcript' | 'decisions' | 'audio'>): string {
  if (record.status === 'in_progress') return 'Локальный сеанс открыт';
  if (!record.transcript.length && !record.decisions.length && !record.audio?.size) {
    return 'Материалов пока нет';
  }
  return record.status === 'interrupted' ? 'Локальный сеанс прерван' : 'Локальный сеанс закрыт';
}
