import type {
  ClinicalLanguage,
  ClinicalSuggestion,
  ClinicalSuggestionCategory,
} from './clinical-contract';

export type SuggestionDecisionStatus = 'pending' | 'accepted' | 'discarded';

export type AcceptedSuggestionSnapshot = {
  title: string;
  clinicianPrompt: string;
  category: ClinicalSuggestionCategory;
  evidenceSegmentIds: string[];
  acceptedAt: string;
};

export type SuggestionLedgerEntry = {
  id: string;
  suggestion: ClinicalSuggestion;
  draftTitle: string;
  draftPrompt: string;
  status: SuggestionDecisionStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  decidedAt?: string;
  acceptedSnapshot?: AcceptedSuggestionSnapshot;
};

export type EncounterTranscriptTurn = {
  id: string;
  role: 'doctor' | 'patient' | 'unknown';
  language: ClinicalLanguage;
  text: string;
  startMs: number | null;
};

export type OrionEncounterRecord = {
  version: 1;
  id: string;
  status: 'in_progress' | 'completed' | 'interrupted';
  clinicianName: string;
  patientName?: string;
  startedAt: string;
  endedAt: string | null;
  updatedAt: string;
  durationSeconds: number;
  consent: {
    transcription: boolean;
    audioRecording: boolean;
    confirmedAt: string;
  };
  transcript: EncounterTranscriptTurn[];
  analysisSummary: string | null;
  decisions: SuggestionLedgerEntry[];
  audio: Blob | null;
  audioMimeType: string | null;
  audioError: string | null;
};

const ENCOUNTERS_STORE = 'encounters';

function openHistoryDatabase() {
  // The legacy archive has no owner/session partition. It must never be opened
  // in cloud mode, even after a successful login or with a forged UI flag.
  return Promise.reject<IDBDatabase>(new Error('Общий браузерный архив изолирован и отключён. Используйте сохранённые серверные приёмы.'));
}

function runRequest<T>(
  mode: IDBTransactionMode,
  execute: (store: IDBObjectStore) => IDBRequest<T>,
) {
  return openHistoryDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(ENCOUNTERS_STORE, mode);
        const request = execute(transaction.objectStore(ENCOUNTERS_STORE));
        let result: T;
        let settled = false;
        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = () => {
          if (settled) return;
          settled = true;
          reject(request.error ?? new Error('Ошибка локальной истории.'));
        };
        transaction.oncomplete = () => {
          if (settled) return;
          settled = true;
          resolve(result);
        };
        transaction.onabort = () => {
          if (settled) return;
          settled = true;
          reject(
            transaction.error ?? new Error('Изменения истории не сохранены.'),
          );
        };
      }),
  );
}

export async function saveEncounter(record: OrionEncounterRecord) {
  await runRequest('readwrite', (store) => store.put(record));
}

export async function listEncounters() {
  const records = await runRequest<OrionEncounterRecord[]>('readonly', (store) =>
    store.getAll(),
  );
  return records.sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  );
}

export async function markAbandonedEncountersInterrupted() {
  const records = await listEncounters();
  const abandoned = records.filter((record) => record.status === 'in_progress');
  await Promise.all(
    abandoned.map((record) =>
      saveEncounter({
        ...record,
        status: 'interrupted',
        endedAt: record.endedAt ?? record.updatedAt,
        updatedAt: new Date().toISOString(),
      }),
    ),
  );
}
