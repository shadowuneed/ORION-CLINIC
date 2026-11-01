import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicalEncounterWorkspace } from './encounter-workspace';
import { encounterFixture } from '@/lib/clinical/test-fixtures';

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Rendering must not request clinical or AI data'); })); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

function openingTag(html: string, id: string) {
  return html.match(new RegExp(`<(?:div|section)[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
}

describe('single-screen persisted clinical encounter', () => {
  it('renders a bounded loading state without fake patient data', () => {
    const html = renderToStaticMarkup(createElement(ClinicalEncounterWorkspace, { encounterId: 'encounter-1' }));
    expect(html).toContain('Открываем приём'); expect(html).not.toContain('<textarea');
  });
  it('opens on the conversation, keeps the clinical note in its tab and places AI in the sidebar', () => {
    const html = renderToStaticMarkup(createElement(ClinicalEncounterWorkspace, { encounterId: 'encounter-1', initialSnapshot: encounterFixture() }));
    expect(html).toContain('Начать запись'); expect(html).not.toContain('Завершить и проверить');
    expect(html).toContain('Черновик — до проверки врачом'); expect(html).toContain('Живая расшифровка');
    expect(openingTag(html, 'conversation-pane')).not.toContain('hidden');
    expect(openingTag(html, 'note-pane')).toContain('hidden=""');
    expect(html).toMatch(/id="conversation-tab"[^>]*aria-selected="true"/);
    expect(html).toMatch(/id="note-tab"[^>]*aria-selected="false"/);
    expect(html.indexOf('Живая расшифровка')).toBeLessThan(html.indexOf('<aside'));
    expect(html.indexOf('Подсказки по разговору')).toBeGreaterThan(html.indexOf('<aside'));
    expect(html.match(/<textarea/g)).toHaveLength(5);
    expect(html).not.toContain('href="/live'); expect(html).not.toContain('Собрать протокол');
  });
  it('does not enable external AI merely because consent was saved previously', () => {
    const data = encounterFixture(); data.consents[0].externalAiProcessing = true;
    const html = renderToStaticMarkup(createElement(ClinicalEncounterWorkspace, { encounterId: 'encounter-1', initialSnapshot: data }));
    expect(html).toContain('Подсказки выключены'); expect(html).toContain('Включить подсказки');
    expect(html).not.toContain('Приостановить подсказки ИИ'); expect(html).not.toContain('Сохранить заключение и завершить');
  });
  it('opens a completed encounter on the read-only published note without recording or AI-start controls', () => {
    const data = encounterFixture(); data.encounters[0].status = 'completed';
    data.notes[0].status = 'published'; data.notes[0].publishedAt = data.generatedAt;
    data.encounters[0].publishedNoteId = data.notes[0].id;
    const html = renderToStaticMarkup(createElement(ClinicalEncounterWorkspace, { encounterId: 'encounter-1', initialSnapshot: data }));
    expect(openingTag(html, 'conversation-pane')).toContain('hidden=""');
    expect(openingTag(html, 'note-pane')).not.toContain('hidden');
    expect(html).toContain('Проверенное заключение'); expect(html).toContain('Разговор сохранён');
    expect(html).not.toContain('Начать запись'); expect(html).not.toContain('Продолжить запись');
    expect(html).not.toContain('Включить подсказки'); expect(html).not.toContain('Сохранить заключение и завершить');
    expect(html).not.toMatch(/<textarea[^>]*id="clinical-(?:complaints|history|examination|assessment|plan)"/);
  });
  it('starts with external AI opt-in unchecked and never auto-publishes', () => {
    const data = encounterFixture(); data.consents = [];
    const html = renderToStaticMarkup(createElement(ClinicalEncounterWorkspace, { encounterId: 'encounter-1', initialSnapshot: data }));
    expect(html).not.toContain('checked=""'); expect(html).toContain('необязательно: передача текста Groq');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Начать запись/);
    expect(html).not.toContain('Сохранить заключение и завершить');
  });
  it('only the treating clinician sees editing controls', () => {
    const data = encounterFixture(); data.encounters[0].practitionerId = 'doctor-2';
    const html = renderToStaticMarkup(createElement(ClinicalEncounterWorkspace, { encounterId: 'encounter-1', initialSnapshot: data }));
    expect(html).not.toContain('<textarea'); expect(html).not.toContain('Начать запись');
  });
  it('uses the existing unified patient routes from loading, selection and an open encounter', () => {
    const loading = renderToStaticMarkup(createElement(ClinicalEncounterWorkspace, { encounterId: null }));
    const choosing = renderToStaticMarkup(createElement(ClinicalEncounterWorkspace, { encounterId: null, initialSnapshot: encounterFixture() }));
    const encounter = renderToStaticMarkup(createElement(ClinicalEncounterWorkspace, { encounterId: 'encounter-1', initialSnapshot: encounterFixture() }));
    expect(loading).toContain('href="/patients"'); expect(choosing).toContain('href="/patients"');
    expect(encounter).toContain('href="/patients/patient-1"');
    expect(`${loading}${choosing}${encounter}`).not.toContain('/clinical/patients');
  });
});
