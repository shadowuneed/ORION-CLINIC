import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SectionPurpose } from './section-purpose';

it('distinguishes a future assigned task from an observed measurement', () => {
  const care = renderToStaticMarkup(createElement(SectionPurpose, {kind:'care'}));
  const measurements = renderToStaticMarkup(createElement(SectionPurpose, {kind:'measurements'}));
  expect(care).toContain('Что нужно сделать дальше?');
  expect(care).toContain('сроком и ответственным');
  expect(care).toContain('Врач утверждает план');
  expect(measurements).toContain('Что измерили у пациента?');
  expect(measurements).toContain('диагноз и лечение автоматически не меняются');
  expect(measurements).toContain('120/80');
});
