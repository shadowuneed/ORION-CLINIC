import type { ClinicalSnapshot } from './contracts';
import { emptyEncounterNote } from './encounter-workflow';

/** Artificial, in-memory fixture. Never a fallback for a missing database. */
export function encounterFixture(): ClinicalSnapshot {
  const time = '2026-10-07T08:00:00.000Z';
  const content = { ...emptyEncounterNote(), complaints: 'Учебная жалоба из записи врача' };
  return { schemaVersion: 1, clinicId: 'clinic-1', practitioner: { id: 'doctor-1', staffId: 'staff-1', name: 'Врач один', specialty: 'Терапия' },
    practitioners: [{ id: 'doctor-1', staffId: 'staff-1', name: 'Врач один', specialty: 'Терапия' }, { id: 'doctor-2', staffId: 'staff-2', name: 'Врач два', specialty: 'Эндокринология' }],
    patients: [{ id: 'patient-1', name: 'Учебный пациент', mrn: 'EDU-1', sex: 'unknown', birthDate: null }],
    encounters: [{ id: 'encounter-1', patientId: 'patient-1', practitionerId: 'doctor-1', visitId: null, referralId: null, status: 'in_progress', version: 2, currentNoteId: 'note-1', publishedNoteId: null, createdAt: time, updatedAt: time }],
    notes: [{ id: 'note-1', encounterId: 'encounter-1', patientId: 'patient-1', practitionerId: 'doctor-1', version: 1, content, source: 'clinician', status: 'draft', createdAt: time, publishedAt: null }],
    referrals: [], consents: [{ encounterId: 'encounter-1', care: true, transcriptStorage: true, localAudioProcessing: true, externalAiProcessing: false, version: 1 }],
    transcript: [], generatedAt: time };
}
