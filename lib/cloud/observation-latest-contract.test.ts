import { describe, expect, it } from 'vitest';
import { CLOUD_OBSERVATION_SOURCE, parseCloudLatestVitals, type CloudObservationTransportScope } from './observation-latest-contract.server';

const now = 1790840000000;
const scope: CloudObservationTransportScope = { organizationId: 'org-a', facilityId: 'facility-a',
  patientId: 'patient-a', accessAssignmentId: 'assignment-a' };
const source = { observationId: 'observation-a', version: 1, measuredAt: now - 10000,
  recordedBy: 'Синтетический сотрудник', sourceLabel: CLOUD_OBSERVATION_SOURCE };
const make = () => ({ ...scope, assignmentVersionId: 'assignment-version-a', role: 'clinician',
  timeZone: 'Asia/Almaty', sourceLabel: CLOUD_OBSERVATION_SOURCE, observedAt: now,
  clinicalInterpretation: 'not_performed', vitals: {
    anthropometry: { ...source, heightCm: 165, weightKg: 64, bmi: 23.51 },
    bloodPressure: { ...source, observationId: 'observation-b', measuredAt: now - 20000, systolicMmhg: 118, diastolicMmhg: 76 },
    temperature: { ...source, observationId: 'observation-c', measuredAt: now - 30000, temperatureC: 36.5 },
  } });

describe('prepared cloud latest-vitals contract', () => {
  it('retains independently sourced measurement groups, without risk or threshold inference', () => {
    const result = parseCloudLatestVitals(make(), scope);
    expect(result.vitals.anthropometry?.measuredAt).toBe(now - 10000);
    expect(result.vitals.bloodPressure?.measuredAt).toBe(now - 20000);
    expect(result.vitals.temperature?.measuredAt).toBe(now - 30000);
    expect(result.clinicalInterpretation).toBe('not_performed');
    expect(result).not.toHaveProperty('risk');
  });
  it('accepts absence instead of replacing missing values with normal-looking numbers', () => {
    expect(parseCloudLatestVitals({ ...make(), role: 'nurse', vitals: {
      anthropometry: null, bloodPressure: null, temperature: null,
    } }, scope).vitals).toEqual({ anthropometry: null, bloodPressure: null, temperature: null });
  });
  it.each(['organizationId', 'facilityId', 'patientId', 'accessAssignmentId'] as const)('rejects wrong %s', field => {
    expect(() => parseCloudLatestVitals({ ...make(), [field]: 'other-scope' }, scope)).toThrow();
  });
  it.each([
    { bmi: 24 }, { bmi: null }, { bmi: 23.511 }, { weightKg: 64.0001 },
    { heightCm: 165.01 }, { heightCm: 0 }, { weightKg: 0 }, { bmi: Number.NaN },
  ])('rejects inconsistent or unscaled anthropometry %j', patch => {
    const fixture = make(); Object.assign(fixture.vitals.anthropometry, patch);
    expect(() => parseCloudLatestVitals(fixture, scope)).toThrow();
  });
  it.each([{ systolicMmhg: 76 }, { diastolicMmhg: 118 }, { systolicMmhg: 118.5 }, { systolicMmhg: 301 }])(
    'rejects invalid blood pressure %j', patch => {
      const fixture = make(); Object.assign(fixture.vitals.bloodPressure, patch);
      expect(() => parseCloudLatestVitals(fixture, scope)).toThrow();
    },
  );
  it.each([
    { timeZone: 'not-a-zone' }, { observedAt: now + 0.1 }, { observedAt: Number.MAX_SAFE_INTEGER + 1 },
    { sourceLabel: 'invented source' }, { role: 'administrator' }, { clinicalInterpretation: 'normal' },
    { riskScore: 87 }, { sourceUrl: 'https://foreign.invalid' },
  ])('rejects malformed or invented envelope data %j', patch => {
    expect(() => parseCloudLatestVitals({ ...make(), ...patch }, scope)).toThrow();
  });
  it('bounds measured time but permits the explicitly allowed five-minute entry window', () => {
    const fixture = make(); fixture.vitals.temperature.measuredAt = now + 300000;
    expect(parseCloudLatestVitals(fixture, scope).vitals.temperature?.measuredAt).toBe(now + 300000);
    fixture.vitals.temperature.measuredAt++;
    expect(() => parseCloudLatestVitals(fixture, scope)).toThrow();
  });
  it('rejects partial measurement groups, oversized metadata and unexpected fields', () => {
    const fixture = make();
    for (const group of [ { ...fixture.vitals.temperature, temperatureC: null },
      { ...fixture.vitals.temperature, recordedBy: 'x'.repeat(301) },
      { ...fixture.vitals.temperature, temperatureC: 36.5001 },
      { ...fixture.vitals.temperature, sourceLabel: 'Локальный ручной ввод · тестовые данные' },
      { ...fixture.vitals.temperature, notes: 'unreviewed private content' } ]) {
      expect(() => parseCloudLatestVitals({ ...fixture, vitals: { ...fixture.vitals, temperature: group } }, scope)).toThrow();
    }
  });
});
