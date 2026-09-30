import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('server-owned first-paint styles', () => {
  it.each([
    ['page.tsx', 'clinic-dashboard.module.css'],
    ['authenticated-clinic-page.tsx', 'clinic-shell.module.css'],
  ])('keeps %s styles in the RSC importer graph before hydration', (file, css) => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    expect(source).not.toMatch(/^['"]use client['"]/);
    expect(source).toContain(`import './${css}';`);
  });
});
