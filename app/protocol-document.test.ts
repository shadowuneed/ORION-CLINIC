import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { ProtocolPreview } from '@/lib/domain/protocol-preview';
import { ProtocolDocument, EncounterMaterials } from './protocol-document';

const document: ProtocolPreview = { id: 'protocol-1', version: 1, status: 'draft', sourceHash: 'saved-hash',
  patient: { displayName: 'Тестовый пациент', medicalRecordNumber: 'TEST-1' },
  sections: [{ code: 'complaints', content: 'Сохранённые жалобы', reviewState: 'reviewed' },
    { code: 'allergy_status', content: '', reviewState: 'explicitly_absent' }],
  recommendations: [{ title: 'Выбранная рекомендация', content: 'Подтверждённый текст' }], amendments: [] };
const render = (patch: Partial<ProtocolPreview> = {}, blocked = false) => renderToStaticMarkup(createElement(ProtocolDocument,
  { document: { ...document, ...patch }, onSign: () => undefined, blocked }));
it('opens the persisted content and clearly labels an unsigned protocol', () => {
  const html = render();
  expect(html).toContain('id="protocol-document"');
  expect(html).toContain('ещё не подписан');
  expect(html).toContain('Сохранённые жалобы');
  expect(html).toContain('Отсутствие сведений подтверждено врачом');
  expect(html).toContain('Выбранная рекомендация');
  expect(html).not.toContain('#protocol-exports');
});
it('blocks signature but not read-only viewing while workspace recovery is pending', () => {
  expect(render({}, true)).toMatch(/disabled=""[^>]*>Перейти к подписи/);
  expect(render({}, true)).toContain('Сохранённые жалобы');
});
it('links a signed version to actual files, without offering to sign again', () => {
  const html = render({ status: 'signed', version: 2, amendments: [{ id: 'a', reason: 'Исправление', text: 'Дополнение врача' }] });
  expect(html).toContain('href="#protocol-exports"');
  expect(html).toContain('Дополнение врача');
  expect(html).not.toContain('Перейти к подписи');
});
it('renders clinical text as text, not HTML', () => {
  expect(render({ sections: [{ code: 'complaints', content: '<script>bad()</script>', reviewState: 'reviewed' }] })).toContain('&lt;script&gt;');
});
it('folds source materials for signed documents but keeps active records immediately accessible', () => {
  const archived = renderToStaticMarkup(createElement(EncounterMaterials, { archived: true }, 'Согласия'));
  expect(archived).toContain('<details');
  expect(archived).not.toContain(' open');
  expect(archived).toContain('Согласия');
  expect(renderToStaticMarkup(createElement(EncounterMaterials, { archived: false }, 'Согласия'))).toBe('Согласия');
});
