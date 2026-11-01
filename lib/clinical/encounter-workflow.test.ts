import { describe, expect, it } from 'vitest';
import { canPublishEncounter, completeReviewedEncounter, emptyEncounterNote, mergeEmptyDraftFields, noteFingerprint, selectEncounterWorkspace, type CompletionCommand } from './encounter-workflow';
import { encounterFixture } from './test-fixtures';

describe('unified encounter review flow', () => {
  it('requires explicit clinician review and stopped recording before publish', () => {
    const input = { canEdit: true, content: { ...emptyEncounterNote(), assessment: 'Проверено врачом' }, reviewed: true, recording: false, saving: false };
    expect(canPublishEncounter(input)).toBe(true);
    expect(canPublishEncounter({ ...input, reviewed: false })).toBe(false);
    expect(canPublishEncounter({ ...input, recording: true })).toBe(false);
    expect(canPublishEncounter({ ...input, saving: true })).toBe(false);
    expect(canPublishEncounter({ ...input, canEdit: false })).toBe(false);
    expect(canPublishEncounter({ ...input, content: emptyEncounterNote() })).toBe(false);
  });
  it('never overwrites clinician fields or invents negative findings for missing AI data', () => {
    const content = { ...emptyEncounterNote(), complaints: 'Записано врачом' };
    const next = mergeEmptyDraftFields(content, { complaints: 'Изменённый ответ ИИ', history: 'Черновик из источника' });
    expect(next.complaints).toBe('Записано врачом');
    expect(next.history).toBe('Черновик из источника');
    expect(next.examination).toBe(''); expect(content.history).toBe('');
  });
  it('does not expose drafts as previous clinical history', () => {
    const data = encounterFixture();
    data.notes.push({ ...data.notes[0], id: 'hidden-draft', encounterId: 'encounter-older' },
      { ...data.notes[0], id: 'published', encounterId: 'encounter-older', status: 'published', publishedAt: data.generatedAt });
    expect(selectEncounterWorkspace(data, 'encounter-1')?.previousNotes.map(note => note.id)).toEqual(['published']);
  });
  it('gives no edit control for a different assigned clinician or a completed encounter', () => {
    const data = encounterFixture(); data.encounters[0].practitionerId = 'doctor-2';
    expect(selectEncounterWorkspace(data, 'encounter-1')?.canEdit).toBe(false);
    data.encounters[0].practitionerId = 'doctor-1'; data.encounters[0].status = 'completed';
    expect(selectEncounterWorkspace(data, 'encounter-1')?.canEdit).toBe(false);
    expect(selectEncounterWorkspace(data, 'unknown-id')).toBeNull();
  });
  it('stable fingerprints are independent of outer whitespace', () => {
    expect(noteFingerprint({ ...emptyEncounterNote(), complaints: ' x ' })).toBe(noteFingerprint({ ...emptyEncounterNote(), complaints: 'x' }));
  });
  it('one completion action saves, explicitly publishes, then completes with the new server version', async () => {
    const data = encounterFixture(); const operations: string[] = [];
    const command = async (input: CompletionCommand) => {
      operations.push(input.type); expect(input.expectedVersion).toBe(data.encounters[0].version);
      if (input.type === 'note.publish') {
        const note = { ...data.notes[0], id: 'published-1', status: 'published' as const, publishedAt: data.generatedAt };
        data.notes.push(note); data.encounters[0].currentNoteId = note.id; data.encounters[0].publishedNoteId = note.id;
      } else data.encounters[0].status = 'completed';
      data.encounters[0].version += 1;
    };
    await completeReviewedEncounter({ reviewed: true, recording: false,
      saveDraft: async () => { operations.push('save'); }, latest: () => selectEncounterWorkspace(data, 'encounter-1')!, command });
    expect(operations).toEqual(['save', 'note.publish', 'encounter.complete']);
    expect(data.encounters[0].status).toBe('completed');
  });
  it('never completes after a failed or unconfirmed publication', async () => {
    const data = encounterFixture(); const operations: string[] = [];
    await expect(completeReviewedEncounter({ reviewed: true, recording: false, saveDraft: async () => undefined,
      latest: () => selectEncounterWorkspace(data, 'encounter-1')!, command: async input => { operations.push(input.type); } })).rejects.toThrow('Публикация ещё не подтверждена');
    expect(operations).toEqual(['note.publish']);
  });
  it('retry after a durable publication resumes completion without publishing again', async () => {
    const data = encounterFixture(); const operations: string[] = [];
    data.notes[0].status = 'published'; data.notes[0].publishedAt = data.generatedAt; data.encounters[0].publishedNoteId = data.notes[0].id;
    await completeReviewedEncounter({ reviewed: true, recording: false, saveDraft: async () => undefined,
      latest: () => selectEncounterWorkspace(data, 'encounter-1')!, command: async input => { operations.push(input.type); } });
    expect(operations).toEqual(['encounter.complete']);
  });
  it('refuses a recording or unreviewed completion before any server writes', async () => {
    let writes = 0; const data = encounterFixture();
    const options = { reviewed: false, recording: false, saveDraft: async () => { writes += 1; }, latest: () => selectEncounterWorkspace(data, 'encounter-1')!, command: async () => { writes += 1; } };
    await expect(completeReviewedEncounter(options)).rejects.toThrow();
    await expect(completeReviewedEncounter({ ...options, reviewed: true, recording: true })).rejects.toThrow();
    expect(writes).toBe(0);
  });
});
