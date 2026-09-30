import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { EncounterReviewGuide, ResumeReviewAction } from './encounter-review-guide';

const noop = () => undefined;
const props = { reviewed: 0, accepted: 2, unresolvedTranscript: 0, status: 'in_progress',
  blocked: null, onNext: noop, onBuild: noop, onTranscript: noop, onSign: noop, onHistory: noop };
const render = (overrides = {}) => renderToStaticMarkup(createElement(EncounterReviewGuide, { ...props, ...overrides }));

it('explains why accepting suggestions is not eight-section approval and where output goes', () => {
  const html = render();
  expect(html).toContain('0/8');
  expect(html).toContain('принято 2');
  expect(html).toContain('не подтверждает восемь разделов');
  expect(html).toContain('отдельным списком в протокол');
  expect(html).toContain('Word, PDF и ZIP');
  expect(html).toContain('Открыть историю пациента');
  expect(html).toContain('Черновик ещё не подписанный протокол');
  expect(html).toContain('Принимать все подсказки ИИ не требуется');
  expect(html).toMatch(/disabled=""[^>]*>Собрать протокол/);
});
it('offers local recovery without implying microphone or medical approval', () => {
  const html = renderToStaticMarkup(createElement(ResumeReviewAction, { busy: false, disabled: false, message: null, onResume: noop }));
  expect(html).toContain('Продолжить работу с этим приёмом');
  expect(html).toContain('не включает микрофон и не одобряет текст ИИ');
  expect(html).not.toContain('disabled');
  const busy = renderToStaticMarkup(createElement(ResumeReviewAction, { busy: true, disabled: false, message: 'Проверяем', onResume: noop }));
  expect(busy).toContain('disabled');
});
it.each([{ reviewed: 7 }, { reviewed: 8, unresolvedTranscript: 1 }, { reviewed: 8, blocked: 'Нет доступа' }])(
  'does not offer an enabled build while a prerequisite fails: %j', (patch) => {
    expect(render(patch)).toMatch(/disabled=""[^>]*>Собрать протокол/);
  },
);
it('allows assembly at 8/8 without requiring every AI suggestion to be accepted', () => {
  expect(render({ reviewed: 8, accepted: 0 })).not.toContain('disabled');
});
it('routes reviewed and signed encounters to their next actual action', () => {
  expect(render({ status: 'review', reviewed: 8 })).toContain('Открыть проверку и подпись протокола');
  expect(render({ status: 'finalized', reviewed: 8 })).toContain('href="#protocol-exports"');
  expect(render({ status: 'finalized', reviewed: 8 })).not.toContain('Собрать протокол для проверки');
});
