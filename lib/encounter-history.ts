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

const DATABASE_NAME = 'orion-local-history';
const DATABASE_VERSION = 1;
const ENCOUNTERS_STORE = 'encounters';

let databasePromise: Promise<IDBDatabase> | null = null;

function openHistoryDatabase() {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.reject(
      new Error('Локальная история недоступна в этом браузере.'),
    );
  }

  if (databasePromise) return databasePromise;

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error('Не удалось открыть локальную историю.'));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error('Локальная история занята другой вкладкой ORION.'));
    };
    request.onupgradeneeded = () => {
      const database = request.result;
      if (database.objectStoreNames.contains(ENCOUNTERS_STORE)) return;
      const store = database.createObjectStore(ENCOUNTERS_STORE, {
        keyPath: 'id',
      });
      store.createIndex('startedAt', 'startedAt');
      store.createIndex('status', 'status');
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });

  return databasePromise;
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
