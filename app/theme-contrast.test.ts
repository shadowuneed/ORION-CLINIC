import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
function tokens(selector: string, source = stylesheet) {
  const body = source.slice(source.indexOf(selector)).split('}')[0];
  return Object.fromEntries(Array.from(body.matchAll(/(--[\w-]+):\s*(#[\da-f]{3,6});/g), (match) => [match[1], match[2]]));
}
function luminance(hex: string) {
  const value = hex.length === 4 ? hex.slice(1).split('').map((channel) => channel + channel).join('') : hex.slice(1);
  const linear = value.match(/../g)!.map((channel) => parseInt(channel, 16) / 255)
    .map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (values[0] + .05) / (values[1] + .05);
}

describe('readable shared clinical theme', () => {
  it.each([':root', "html[data-theme='dark']"])('keeps ordinary, secondary and muted text readable across %s surfaces', (selector) => {
    const palette = tokens(selector);
    for (const ink of ['--ink', '--ink-soft', '--ink-muted']) {
      for (const surface of ['--canvas', '--surface', '--surface-strong', '--surface-muted']) {
        expect(contrast(palette[ink], palette[surface]), `${selector}: ${ink} / ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(palette['--selection-ink'], palette['--selection-surface'])).toBeGreaterThanOrEqual(4.5);
    for (const brand of ['--brand', '--brand-strong']) {
      expect(contrast(palette['--on-brand'], palette[brand]), `${selector}: primary button / ${brand}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(palette['--focus-ring'], palette['--surface'])).toBeGreaterThanOrEqual(3);
  });
  it.each(['.orion-shell', "html[data-theme='dark'] .orion-shell"])('keeps LIVE recorder secondary labels readable in %s', (selector) => {
    const palette = tokens(selector, readFileSync(new URL('./live/legacy-orion.css', import.meta.url), 'utf8'));
    for (const ink of ['--ink', '--muted', '--body-text', '--text-subtle', '--text-soft']) {
      for (const surface of ['--paper', '--wash', '--surface', '--surface-subtle', '--surface-soft']) {
        expect(contrast(palette[ink], palette[surface]), `${selector}: ${ink} / ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(palette['--focus-ring'], palette['--surface'])).toBeGreaterThanOrEqual(3);
  });
});
