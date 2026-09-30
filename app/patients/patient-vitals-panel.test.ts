import { existsSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PatientDetail, PatientSexAtBirth } from '@/lib/repositories/patient-registry';
import { PatientVitalsPanel } from './[patientId]/patient-vitals-panel';

function render(sexAtBirth: PatientSexAtBirth) {
  return renderToStaticMarkup(createElement(PatientVitalsPanel, {
    patient: { sexAtBirth, latestEncounter: null } as PatientDetail,
    measurement: { state: 'ready', value: null },
    measurementsUrl: '/observations', encounterUrl: null, encounterStatus: null,
  }));
}

describe('patient anatomy follows the recorded sex', () => {
  it.each([
    ['female', 'anatomy-female-v1.png', 'Женская'],
    ['male', 'anatomy-v1.png', 'Мужская'],
    ['unknown', 'anatomy-v1.png', 'Общая'],
    ['not_recorded', 'anatomy-v1.png', 'Общая'],
  ] as const)('renders %s without inventing measurements', (sex, asset, label) => {
    const html = render(sex);
    expect(html).toContain(`src="/patient-body/${asset}"`);
    expect(html).toContain(`alt="${label} анатомическая схема`);
    expect(html).toContain('Измерений пока нет');
    expect(html).not.toContain('aria-pressed="true"');
    expect(existsSync(new URL(`../../public/patient-body/${asset}`, import.meta.url))).toBe(true);
  });

  it('changes the image when the recorded field changes', () => {
    expect(render('female')).not.toContain('src="/patient-body/anatomy-v1.png"');
    expect(render('male')).not.toContain('anatomy-female-v1.png');
  });
});
