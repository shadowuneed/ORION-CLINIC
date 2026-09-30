import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Loading from '../loading';
import { OrionBrand, OrionLoading, OrionMark, OrionWordmark } from './orion-brand';

function renderMark(animated = false, size?: number) {
  return renderToStaticMarkup(createElement(OrionMark, { animated, size }));
}

function referencedId(tag: string, attribute: 'mask' | 'clip-path') {
  const reference = tag.match(new RegExp(`${attribute}="url\\(#([^)]+)\\)"`));
  expect(reference, `${attribute} must point to a local SVG definition`).not.toBeNull();
  return reference![1];
}

describe('ORION orbital mark depth', () => {
  it('uses unique instance-local definitions for every mask and clip reference', () => {
    const html = renderToStaticMarkup(createElement('div', null,
      createElement(OrionMark),
      createElement(OrionMark, { animated: true }),
      createElement(OrionBrand, { animated: true }),
      createElement(OrionLoading),
    ));
    const svgs = [...html.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/g)].map(match => match[0]);
    expect(svgs).toHaveLength(4);
    const allIds: string[] = [];

    for (const svg of svgs) {
      const ids = [...svg.matchAll(/<(?:mask|clipPath)\b[^>]*\bid="([^"]+)"/g)].map(match => match[1]);
      const references = [...svg.matchAll(/(?:mask|clip-path)="url\(#([^)]+)\)"/g)].map(match => match[1]);
      expect(ids.length).toBeGreaterThanOrEqual(4);
      expect(references.length).toBeGreaterThanOrEqual(5);
      for (const id of references) expect(ids, `reference ${id} must stay inside its own SVG`).toContain(id);
      for (const id of ids) expect(references, `definition ${id} must actually be used`).toContain(id);
      allIds.push(...ids);
    }

    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it.each([false, true])('paints back orbit, O body, then front orbit (animated=%s)', animated => {
    const svg = renderMark(animated);
    const back = svg.match(/<g\b[^>]*data-orbit-layer="back"[^>]*>/);
    const body = svg.match(/<circle\b(?=[^>]*\bmask=)[^>]*>/);
    const front = svg.match(/<g\b[^>]*data-orbit-layer="front"[^>]*>/);
    expect(back).not.toBeNull();
    expect(body).not.toBeNull();
    expect(front).not.toBeNull();
    expect(back!.index).toBeLessThan(body!.index!);
    expect(body!.index).toBeLessThan(front!.index!);

    const behindMaskId = referencedId(back![0], 'mask');
    const bodyMaskId = referencedId(body![0], 'mask');
    expect(behindMaskId).not.toBe(bodyMaskId);
    expect(front![0]).not.toContain('mask=');

    const backLayer = svg.slice(back!.index, body!.index);
    const frontLayer = svg.slice(front!.index);
    const backClipId = referencedId(backLayer, 'clip-path');
    const frontClipId = referencedId(frontLayer, 'clip-path');
    expect(backClipId).not.toBe(frontClipId);
    expect(backLayer).toContain('stroke="currentColor"');
    expect(frontLayer).toContain('stroke="currentColor"');

    const masks = [...svg.matchAll(/<mask\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/mask>/g)];
    const behindMask = masks.find(match => match[1] === behindMaskId)?.[2];
    const bodyMask = masks.find(match => match[1] === bodyMaskId)?.[2];
    expect(behindMask).toMatch(/<circle\b[^>]*fill="black"/);
    expect(bodyMask).toContain(`clip-path="url(#${frontClipId})"`);
    expect(bodyMask).not.toContain(`clip-path="url(#${backClipId})"`);
  });

  it('keeps the mark decorative and inherits foreground color in busy buttons', () => {
    const html = renderMark(true, 20);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
    expect(html).toContain('data-orion-mark="animated"');
    expect(html).toContain('width="20" height="20"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).not.toMatch(/role=|aria-live=|<title|<script|<animate/);
  });
});

describe('ORION wordmark and loading semantics', () => {
  it('renders a separate readable wordmark without hiding its brand text', () => {
    const html = renderToStaticMarkup(createElement(OrionWordmark, { className: 'custom-wordmark' }));
    expect(html).toContain('<strong>ORION</strong>');
    expect(html).toContain('<small>Clinic</small>');
    expect(html).toContain('custom-wordmark');
    expect(html).not.toMatch(/aria-hidden|<svg|role="status"/);
  });

  it('does not announce decorative brand animation as a loading operation', () => {
    const html = renderToStaticMarkup(createElement(OrionBrand, {
      animated: true, className: 'custom-brand', wordmarkClassName: 'custom-wordmark', size: 44,
    }));
    expect(html).toContain('data-orion-mark="animated"');
    expect(html).toContain('custom-brand');
    expect(html).toContain('custom-wordmark');
    expect(html).toContain('<strong>ORION</strong>');
    expect(html).toContain('width="44" height="44"');
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(1);
    expect(html).not.toMatch(/role="status"|aria-live=|aria-busy=/);
  });

  it('has a static default mark for non-loading contexts', () => {
    const html = renderMark();
    expect(html).toContain('data-orion-mark="static"');
    expect(html).toContain('width="40" height="40"');
    expect(html).not.toContain('data-orion-mark="animated"');
  });

  it.each([
    [false, 76],
    [true, 24],
  ] as const)('announces one status, not a nested status, with compact=%s', (compact, size) => {
    const html = renderToStaticMarkup(createElement(OrionLoading, {
      compact, label: 'Сохраняем изменения…', className: 'custom-loading',
    }));
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html.match(/aria-live="polite"/g)).toHaveLength(1);
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain('Сохраняем изменения…');
    expect(html).toContain('custom-loading');
    expect(html).toContain(`width="${size}" height="${size}"`);
    expect(html).toContain('data-orion-mark="animated"');
    expect(html).not.toMatch(/role="progressbar"|aria-valuenow=|aria-valuemin=|aria-valuemax=/);
  });

  it('uses the branded indicator in the actual route loading fallback', () => {
    const html = renderToStaticMarkup(createElement(Loading));
    expect(html).toContain('Открываем раздел ORION Clinic…');
    expect(html).toContain('data-orion-mark="animated"');
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).not.toMatch(/<button|<form|<script|aria-valuenow=/);
    const routeLoadingCss = readFileSync(new URL('../loading.module.css', import.meta.url), 'utf8');
    expect(routeLoadingCss).toMatch(/position:\s*fixed/);
    expect(routeLoadingCss).toMatch(/place-items:\s*center/);
  });

  it('has static reduced-motion and unsupported-motion fallbacks in CSS', () => {
    const css = readFileSync(new URL('./orion-brand.module.css', import.meta.url), 'utf8');
    const reducedMotion = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/)?.[1];
    const unsupportedMotion = css.match(/@supports not\s*\(offset-path:[^\n]+\{([\s\S]*?)\n\}/)?.[1];
    expect(reducedMotion).toMatch(/animation:\s*none/);
    expect(reducedMotion).toMatch(/offset-path:\s*none/);
    expect(unsupportedMotion).toMatch(/animation:\s*none/);
    expect(css).toMatch(/@keyframes\s+orion-orbit/);
  });
});
