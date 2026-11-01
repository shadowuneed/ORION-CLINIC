import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RegionalFacility, RegionalScope } from '@/lib/regional/contracts';
import { RegionalFacilityPreview, type FacilityPreviewProps } from './regional-facility-preview';

const facility: RegionalFacility = { id: 'sozak-hospital', clinicId: 'regional-sozak-hospital', districtId: 'sozak',
  name: 'Больница · Сузакский район', kind: 'hospital', latitude: 43.88, longitude: 69.18,
  address: 'Учебное учреждение', populated: true, hospitalCount: 1, polyclinicCount: 0,
  patientCount: 24, activeVisits: 6, queuedVisits: 3, openTasks: 7, overdueTasks: 1,
  completedTasks: 0, totalTasks: 7, onTimeTasks: 0, dueTasks: 1, kpiPercent: 0 };
function props(overrides: Partial<FacilityPreviewProps> = {}): FacilityPreviewProps {
  return { facility, districtName: 'Сузакский район', disabled: false,
    onEnter: vi.fn(), onClose: vi.fn(), onIndicators: vi.fn(), ...overrides };
}

describe('institution preview entry and source counters', () => {
  it.each(['hospital', 'polyclinic'] as const)('offers an explicit and type-specific entry into %s', kind => {
    const value = props({ facility: { ...facility, kind } });
    const html = renderToStaticMarkup(createElement(RegionalFacilityPreview, value));
    expect(html).toContain(kind === 'hospital' ? 'Войти в больницу' : 'Войти в поликлинику');
    expect(html).not.toContain(kind === 'hospital' ? 'Войти в поликлинику' : 'Войти в больницу');
    expect(html).toContain('Показатели и отчёты');
    expect(html).toContain('aria-label="Закрыть сводку учреждения"');
    expect(value.onEnter).not.toHaveBeenCalled();
    expect(value.onClose).not.toHaveBeenCalled();
    expect(value.onIndicators).not.toHaveBeenCalled();
  });

  it('renders only the counters supplied by the saved facility summary', () => {
    const html = renderToStaticMarkup(createElement(RegionalFacilityPreview, props()));
    expect(html.match(/<dd>\d+<\/dd>/g)).toEqual(['<dd>24</dd>', '<dd>3</dd>', '<dd>6</dd>', '<dd>7</dd>']);
    expect(html).toContain('data-attention="true"');
    expect(html).not.toContain('0%');
  });

  it('does not invent zero patient or task metrics when only an assignment scope is available', () => {
    const assigned: RegionalScope['facilities'][number] = { id: facility.id, name: facility.name,
      kind: facility.kind, clinicId: facility.clinicId, districtId: facility.districtId, canManage: false };
    const html = renderToStaticMarkup(createElement(RegionalFacilityPreview, props({ facility: assigned })));
    expect(html).toContain('Войти в больницу');
    expect(html).not.toContain('<dl');
    expect(html).not.toContain('<dd>0</dd>');
  });

  it('disables every navigation action during a blocked save without invoking callbacks on render', () => {
    const value = props({ disabled: true });
    const html = renderToStaticMarkup(createElement(RegionalFacilityPreview, value));
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(3);
    expect(buttons.every(button => button.includes('disabled=""'))).toBe(true);
    expect(value.onEnter).not.toHaveBeenCalled();
    expect(value.onClose).not.toHaveBeenCalled();
    expect(value.onIndicators).not.toHaveBeenCalled();
  });

  it('does not render patient records accidentally attached to summary input, and escapes institution labels', () => {
    const supplied = { ...facility, name: '<script>unsafe()</script>',
      patients: [{ name: 'PRIVATE_PATIENT_NAME', iin: 'PRIVATE_PATIENT_IDENTIFIER' }],
      medicalRecords: [{ diagnosis: 'PRIVATE_CLINICAL_NOTE' }] };
    const html = renderToStaticMarkup(createElement(RegionalFacilityPreview, props({ facility: supplied })));
    expect(html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('PRIVATE_');
  });
});
