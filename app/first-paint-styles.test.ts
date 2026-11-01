import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FirstPaintStyles, safeFirstPaintCss } from './first-paint-styles';

describe('server-owned first-paint styles', () => {
  it.each([
    ['page.tsx', 'clinic-dashboard.module.css'],
    ['authenticated-clinic-page.tsx', 'clinic-shell.module.css'],
  ])('keeps %s styles in the RSC importer graph before hydration', (file, css) => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    expect(source).not.toMatch(/^['"]use client['"]/);
    expect(source).toContain(`import './${css}';`);
  });
  it('embeds compiled CSS before client hydration without a script/loading gate', () => {
    const html = renderToStaticMarkup(createElement(FirstPaintStyles, { id: 'crm', css: '.workspace{display:grid}' }));
    expect(html).toBe('<style data-orion-first-paint="crm">.workspace{display:grid}</style>');
    expect(html).not.toContain('display:none');
  });
  it('cannot terminate its style element through a CSS string', () => {
    const css = safeFirstPaintCss('/* </STYLE><script>unsafe</script> */');
    expect(css).not.toMatch(/<\/style/i);
  });
  it('pins the scheduling module CSS in the server CRM boundary before client hydration', () => {
    const source = readFileSync(new URL('crm/page.tsx', import.meta.url), 'utf8');
    expect(source).toContain("import schedulingFirstPaintCss from './crm-scheduling.module.css?inline'");
    expect(source).toContain('schedulingFirstPaintCss');
    expect(source.indexOf('<FirstPaintStyles')).toBeLessThan(source.indexOf('<CrmWorkspace'));
  });
  it('embeds the regional KPI panel CSS before the regional client workspace', () => {
    const source = readFileSync(new URL('crm/page.tsx', import.meta.url), 'utf8');
    expect(source).toContain("import regionalKpiFirstPaintCss from './region/regional-kpi-panel.module.css?inline'");
    const regionalBoundary = source.slice(source.indexOf('return <ClinicalShell'), source.indexOf('<RegionalWorkspace initialDistrictId'));
    expect(regionalBoundary).toContain('${regionalKpiFirstPaintCss}');
    expect(regionalBoundary).toContain('<FirstPaintStyles id="regional-crm"');
  });
  it('embeds directive document workspace styles before hydration', () => {
    const source = readFileSync(new URL('crm/page.tsx', import.meta.url), 'utf8');
    expect(source).toContain("import directivesFirstPaintCss from './region/regional-directives-panel.module.css?inline'");
    expect(source).toContain('<FirstPaintStyles id="regional-directives" css={directivesFirstPaintCss} /><RegionalDirectivesPanel');
    expect(source).toContain("query.view === 'directives'");
  });
});
