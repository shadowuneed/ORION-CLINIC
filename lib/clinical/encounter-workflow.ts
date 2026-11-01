import type { ClinicalNoteContent, ClinicalSnapshot } from './contracts';

export type CompletionCommand = { type: 'note.publish'; encounterId: string; expectedVersion: number; noteId: string; reviewAcknowledged: true } |
  { type: 'encounter.complete'; encounterId: string; expectedVersion: number };

export const encounterSections = [
  { key: 'complaints', title: 'Жалобы', hint: 'Что беспокоит пациента и с какого времени' },
  { key: 'history', title: 'Анамнез и важные сведения', hint: 'Развитие симптомов, заболевания, лекарства и аллергии — только известные сведения' },
  { key: 'examination', title: 'Осмотр и показатели', hint: 'Результаты проведённого осмотра; непроведённое не заполняйте' },
  { key: 'assessment', title: 'Заключение врача', hint: 'Ваша оценка, диагноз или вопросы для уточнения' },
  { key: 'plan', title: 'План и рекомендации', hint: 'Подтверждённые вами дальнейшие действия' },
] as const;
export function emptyEncounterNote(): ClinicalNoteContent { return { complaints: '', history: '', examination: '', assessment: '', plan: '' }; }
export function noteFingerprint(content: ClinicalNoteContent) { return JSON.stringify(encounterSections.map(section => content[section.key].trim())); }
export function hasClinicalNote(content: ClinicalNoteContent) { return encounterSections.some(section => content[section.key].trim()); }
export function selectEncounterWorkspace(snapshot: ClinicalSnapshot, encounterId: string) {
  const encounter = snapshot.encounters.find(item => item.id === encounterId);
  if (!encounter) return null;
  const patient = snapshot.patients.find(item => item.id === encounter.patientId);
  if (!patient) return null;
  const currentNote = snapshot.notes.find(item => item.id === encounter.currentNoteId && item.encounterId === encounter.id) ?? null;
  const publishedNote = snapshot.notes.find(item => item.id === encounter.publishedNoteId && item.encounterId === encounter.id && item.status === 'published') ?? null;
  return {
    encounter, patient, currentNote, publishedNote,
    canEdit: encounter.practitionerId === snapshot.practitioner.id && encounter.status === 'in_progress',
    consent: snapshot.consents.find(item => item.encounterId === encounter.id) ?? null,
    transcript: snapshot.transcript.filter(item => item.encounterId === encounter.id).sort((a, b) => a.sequence - b.sequence),
    previousNotes: snapshot.notes.filter(item => item.patientId === patient.id && item.encounterId !== encounter.id && item.status === 'published')
      .sort((a, b) => (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt)),
    referrals: snapshot.referrals.filter(item => item.encounterId === encounter.id),
  };
}
export function canPublishEncounter(input: { canEdit: boolean; content: ClinicalNoteContent; reviewed: boolean; recording: boolean; saving: boolean }) {
  return input.canEdit && hasClinicalNote(input.content) && input.reviewed && !input.recording && !input.saving;
}
/** AI suggestions never replace a clinician's text or establish absence of a finding. */
export function mergeEmptyDraftFields(current: ClinicalNoteContent, proposed: Partial<ClinicalNoteContent>): ClinicalNoteContent {
  const next = { ...current };
  for (const { key } of encounterSections) if (!current[key].trim() && proposed[key]?.trim()) next[key] = proposed[key]!.trim();
  return next;
}

/** Recording completion is not publication. Only a reviewed, persisted note may complete care. */
export async function completeReviewedEncounter(input: {
  reviewed: boolean; recording: boolean; saveDraft: () => Promise<void>;
  latest: () => NonNullable<ReturnType<typeof selectEncounterWorkspace>>;
  command: (command: CompletionCommand) => Promise<unknown>;
}) {
  if (!input.reviewed || input.recording) throw new Error('Остановите запись и проверьте заключение перед публикацией.');
  await input.saveDraft();
  let view = input.latest();
  if (!view.currentNote || !hasClinicalNote(view.currentNote.content)) throw new Error('Заполните заключение врача; пустой протокол не публикуется.');
  if (view.currentNote.status !== 'published') {
    await input.command({ type: 'note.publish', encounterId: view.encounter.id, expectedVersion: view.encounter.version, noteId: view.currentNote.id, reviewAcknowledged: true });
    view = input.latest();
  }
  if (!view.publishedNote || view.publishedNote.id !== view.currentNote?.id) throw new Error('Публикация ещё не подтверждена базой. Обновите состояние перед завершением.');
  if (view.encounter.status !== 'completed') await input.command({ type: 'encounter.complete', encounterId: view.encounter.id, expectedVersion: view.encounter.version });
}
