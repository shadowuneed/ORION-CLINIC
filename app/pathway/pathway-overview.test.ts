import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
import { pathwaySourceUrl, projectPathwaySource } from './pathway-overview';

const syntheticPatient = { id: 'patient-a', displayName: 'Пациент А.', medicalRecordNumber: 'SYN-001' };

describe('pathway overview projection', () => {
  it('uses only exact selected scope in read URLs', () => {
    const query = new URLSearchParams('facilityId=fac-a&accessAssignmentId=assignment-a&patientId=patient-a&secret=no');
    expect(pathwaySourceUrl('orders', query)).toBe('/api/orders?limit=100&facilityId=fac-a&accessAssignmentId=assignment-a');
    expect(pathwaySourceUrl('observations', query)).toBe('/api/observations?limit=100&facilityId=fac-a&accessAssignmentId=assignment-a');
  });

  it('creates timeline entries only from returned server records', () => {
    const projected = projectPathwaySource('orders', { orders: [{ id: 'order-a', patient: syntheticPatient,
      current: { requestedService: 'Анализ крови', status: 'draft', createdAt: 1_700_000_000_000 } }] });
    expect(projected.count).toBe(1);
    expect(projected.events).toEqual([{ id: 'order-a', patient: syntheticPatient, title: 'Анализ крови',
      subtitle: 'Направление или анализ', date: 1_700_000_000_000, source: 'orders', status: 'draft' }]);
    expect(() => projectPathwaySource('orders', { orders: [{ id: 'x' }] })).toThrow();
  });

  it('does not turn an empty response into fictional activity', () => {
    expect(projectPathwaySource('care', { enrollments: [], tasks: [] })).toEqual({ patients: [], events: [], count: 0 });
    expect(projectPathwaySource('observations', { patients: [syntheticPatient], observations: [] })).toEqual({
      patients: [syntheticPatient], events: [], count: 0,
    });
  });
});
