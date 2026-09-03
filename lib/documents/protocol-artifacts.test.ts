import { strFromU8, unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  generateProtocolArtifacts,
  type SignedProtocolExportSource,
} from './protocol-artifacts';

const source: SignedProtocolExportSource = {
  protocol: {
    id: 'protocol-signed-test',
    version: 2,
    sourceHash: 'a'.repeat(64),
    signedAt: Date.UTC(2026, 7, 31, 9, 30),
    signedByMembershipId: 'membership-clinician-test',
    signedByDisplayName: 'Доктор Сынақ',
  },
  content: {
    schemaVersion: 1,
    dataMode: 'synthetic-only',
    encounter: {
      id: 'encounter-synthetic-test',
      sourceVersion: 2,
      reasonForVisit: 'Бас ауруы и температура',
      startedAt: Date.UTC(2026, 7, 31, 9, 0),
      endedAt: Date.UTC(2026, 7, 31, 9, 25),
    },
    patient: {
      medicalRecordNumber: 'SYN-TEST-001',
      displayName: 'Айдана С.',
      birthDate: '1990-05-12',
      sexAtBirth: 'female',
    },
    clinicianMembershipId: 'membership-clinician-test',
    sections: [
      'complaints',
      'history_of_present_illness',
      'past_medical_history',
      'allergy_status',
      'objective_findings',
      'preliminary_diagnosis',
      'examination_plan',
      'treatment_plan',
    ].map((code, index) => ({
      sourceVersionId: `section-${index + 1}`,
      code: code as SignedProtocolExportSource['content']['sections'][number]['code'],
      version: 1,
      content:
        index === 0
          ? 'Пациент сообщает: басым ауырып тұр, температура 38 °C.'
          : `Проверенный синтетический текст раздела ${index + 1}.`,
      reviewState: 'reviewed' as const,
      reviewedByMembershipId: 'membership-clinician-test',
      reviewedAt: Date.UTC(2026, 7, 31, 9, 20),
    })),
    recommendations: [
      {
        sourceSuggestionId: 'suggestion-synthetic-test',
        sourceAnalysisRunId: 'analysis-synthetic-test',
        sourceDecisionId: 'decision-synthetic-test',
        sourceDerivativeVersionId: 'derivative-synthetic-test-v1',
        state: 'edited_and_accepted',
        original: {
          title: 'Вариант ассистента: уточнить лекарственную терапию',
          content:
            'Спросить пациента о препаратах без дополнительной клинической детализации.',
          evidence: [
            {
              sourceId: 'segment-patient-test',
              quote: 'Пациент пока не перечислил принимаемые препараты.',
            },
          ],
        },
        effective: {
          title: 'Уточнить текущую лекарственную терапию',
          content:
            'Врач подтвердил необходимость уточнить названия, дозировки, кратность и время последнего приёма всех препаратов.',
          evidence: [
            {
              sourceId: 'segment-patient-test',
              quote: 'Пациент пока не перечислил принимаемые препараты.',
            },
          ],
        },
        provenance: {
          provider: 'synthetic',
          model: 'fixture',
          modelVersion: '1',
          policyVersion: 'synthetic-policy-1',
          inputHash: 'c'.repeat(64),
          sourceRecordIds: ['segment-patient-test'],
        },
        reviewedByMembershipId: 'membership-clinician-test',
        reviewedByDisplayName: 'Доктор Сынақ',
        reviewedAt: Date.UTC(2026, 7, 31, 9, 24),
      },
    ],
    transcript: {
      included: true,
      consentEventId: 'consent-transcript-test',
      segments: [
        {
          sourceVersionId: 'segment-doctor-test',
          segmentIndex: 1,
          version: 1,
          role: 'doctor',
          roleSource: 'manual',
          language: 'mixed',
          text: 'Сәлеметсіз бе, қай жеріңіз ауырып тұр?',
          startedAtMs: 0,
          endedAtMs: 3200,
          state: 'corrected',
        },
        {
          sourceVersionId: 'segment-patient-test',
          segmentIndex: 2,
          version: 1,
          role: 'patient',
          roleSource: 'manual',
          language: 'mixed',
          text: 'Екі күннен бері басым ауырады и температура көтерілді.',
          startedAtMs: 3500,
          endedAtMs: 7200,
          state: 'corrected',
        },
      ],
    },
    amendments: [
      {
        id: 'amendment-synthetic-test',
        sequence: 1,
        baseProtocolId: 'protocol-signed-base-test',
        reason: 'Уточнение формулировки после личной проверки врача',
        text: 'Добавлено пояснение: пациентке следует обсудить дальнейший план на повторном очном приёме. Қорытындыны дәрігер бекітті.',
        signedByMembershipId: 'membership-clinician-test',
        signedByDisplayName: 'Доктор Сынақ',
        signedAt: Date.UTC(2026, 7, 31, 10, 0),
      },
    ],
  },
  auditEvents: [
    {
      id: 'audit-test-1',
      sequence: 1,
      actorType: 'user',
      actorId: 'user-test',
      action: 'protocol.sign_and_finalize',
      outcome: 'succeeded',
      purpose: 'synthetic_test',
      entityType: 'protocol_version',
      entityId: 'protocol-signed-test',
      requestId: 'request-test',
      metadata: { explicitClinicianConfirmation: true },
      previousHash: null,
      eventHash: 'b'.repeat(64),
      occurredAt: Date.UTC(2026, 7, 31, 9, 30),
    },
  ],
};

describe('signed protocol artifact generation', () => {
  it('creates genuine DOCX/PDF/TXT/JSON and one complete ZIP with RU/KK text', async () => {
    const artifacts = await generateProtocolArtifacts(source);
    expect(artifacts.map((artifact) => artifact.kind)).toEqual([
      'protocol_docx',
      'protocol_pdf',
      'transcript_txt',
      'audit_json',
      'bundle_zip',
    ]);
    expect(new Set(artifacts.map((artifact) => artifact.sha256)).size).toBe(5);

    const docx = artifacts.find((artifact) => artifact.kind === 'protocol_docx')!;
    const docxFiles = unzipSync(docx.bytes);
    const documentXml = strFromU8(docxFiles['word/document.xml']);
    expect(documentXml).toContain('Принятые рекомендации врача');
    expect(documentXml).toContain('Принято после редакции врача');
    expect(documentXml).toContain(
      'Врач подтвердил необходимость уточнить названия, дозировки, кратность и время последнего приёма всех препаратов.',
    );
    expect(documentXml).toContain(
      'Оригинал ИИ (справочно, не является итоговым решением врача)',
    );
    expect(documentXml).toContain(
      'Спросить пациента о препаратах без дополнительной клинической детализации.',
    );
    expect(documentXml).toContain('Подписанные корректировки');
    expect(documentXml).toContain('Уточнение формулировки');
    expect(documentXml).toContain('Қорытындыны дәрігер бекітті');
    expect(documentXml).toContain('Полная расшифровка разговора');
    expect(documentXml).toContain('Сәлеметсіз бе');
    expect(documentXml).toContain('Пациент');

    const pdf = artifacts.find((artifact) => artifact.kind === 'protocol_pdf')!;
    expect(strFromU8(pdf.bytes.subarray(0, 5))).toBe('%PDF-');
    expect((await PDFDocument.load(pdf.bytes)).getPageCount()).toBeGreaterThan(1);

    const transcript = artifacts.find(
      (artifact) => artifact.kind === 'transcript_txt',
    )!;
    expect(strFromU8(transcript.bytes)).toContain(
      'Пациент · RU/KK · сегмент 2, v1',
    );

    const audit = artifacts.find((artifact) => artifact.kind === 'audit_json')!;
    const auditPayload = JSON.parse(strFromU8(audit.bytes));
    expect(auditPayload).toMatchObject({
      schemaVersion: 1,
      dataMode: 'synthetic-only',
      auditEventCount: 1,
      recommendations: [
        {
          sourceSuggestionId: 'suggestion-synthetic-test',
          sourceAnalysisRunId: 'analysis-synthetic-test',
          sourceDecisionId: 'decision-synthetic-test',
          sourceDerivativeVersionId: 'derivative-synthetic-test-v1',
          state: 'edited_and_accepted',
          original: {
            content:
              'Спросить пациента о препаратах без дополнительной клинической детализации.',
          },
          effective: {
            content:
              'Врач подтвердил необходимость уточнить названия, дозировки, кратность и время последнего приёма всех препаратов.',
          },
          reviewedByMembershipId: 'membership-clinician-test',
        },
      ],
    });

    const bundle = artifacts.find((artifact) => artifact.kind === 'bundle_zip')!;
    const bundleFiles = unzipSync(bundle.bytes);
    expect(Object.keys(bundleFiles).sort()).toEqual(
      [...artifacts.slice(0, 4).map((artifact) => artifact.filename), 'manifest.json'].sort(),
    );
    const manifest = JSON.parse(strFromU8(bundleFiles['manifest.json']));
    expect(manifest.files).toHaveLength(4);
    expect(manifest.files[0]).toMatchObject({
      kind: 'protocol_docx',
      sha256: docx.sha256,
      byteSize: docx.bytes.byteLength,
    });
  }, 15_000);
});
