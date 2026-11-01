import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encounterFixture } from '@/lib/clinical/test-fixtures';
import { ClinicalRegistry } from './registry';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());
describe('clinical registry server rendering', () => {
  it('does not draw sample patients or submit registration on load', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const html = renderToStaticMarkup(createElement(ClinicalRegistry));
    expect(html).toContain('Загружаем записи из базы'); expect(html).not.toContain('Учебный пациент'); expect(fetch).not.toHaveBeenCalled();
  });
  it('shows one direct start action for each visible patient and keeps existing encounter accessible', () => {
    const html = renderToStaticMarkup(createElement(ClinicalRegistry, { mode: 'patients', initialSnapshot: encounterFixture() }));
    expect(html).toContain('Мои пациенты'); expect(html).toContain('Учебный пациент'); expect(html.match(/Начать приём/g)).toHaveLength(1);
    expect(html).toContain('Продолжить приём'); expect(html).not.toContain('/live');
  });
  it('never shows unpublished notes as patient-card clinical facts', () => {
    const data = encounterFixture(); const draft = renderToStaticMarkup(createElement(ClinicalRegistry, { patientId: 'patient-1', initialSnapshot: data }));
    expect(draft).not.toContain('Учебная жалоба из записи врача'); expect(draft).toContain('Подтверждённых записей пока нет');
    data.notes[0].status = 'published'; data.notes[0].publishedAt = data.generatedAt;
    const published = renderToStaticMarkup(createElement(ClinicalRegistry, { patientId: 'patient-1', initialSnapshot: data }));
    expect(published).toContain('Учебная жалоба из записи врача');
  });
});
