import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
describe('unified local route wiring', () => {
  it('binds map and schedule starts to the exact chosen visit and renders only one start in the drawer', () => {
    const map = read('../crm/crm-workspace.tsx'); const schedule = read('../crm/crm-scheduling.tsx');
    expect(map).toContain('patientId={selectedPatient.id} visitId={selectedVisit?.id}');
    expect(map).toContain('canWrite={canWrite} suppressStart blocked=');
    expect(schedule).toContain('patientId={visit.patientId} visitId={visit.id}');
    expect(map).toContain('href={`/patients/${encodeURIComponent(selectedPatient.id)}`}');
  });
  it.each(['../page.tsx', '../patients/page.tsx', '../patients/[patientId]/page.tsx', '../pathway/page.tsx', '../access/page.tsx', '../crm/page.tsx'])('selects PG local SSR before legacy D1 governance in %s', file => {
    const source = read(file);
    expect(source.indexOf('if (localAccountModeEnabled())')).toBeGreaterThan(-1);
    expect(source.indexOf('if (localAccountModeEnabled())')).toBeLessThan(source.indexOf('const context = await getAuthenticatedClinicContext'));
    expect(source).toContain('<ClinicalShell');
  });
  it('gates the shell by verified identity, never by stale D1 assignment', () => {
    const source = read('./clinical-shell.tsx');
    expect(source).toContain('await requireChatGPTUser(returnTo)');
    expect(source).not.toContain('getAuthenticatedClinicContext'); expect(source).not.toContain('D1AccessGovernance');
    expect(read('../chatgpt-auth.ts')).toContain("requestHeaders.get('x-orion-local-issuer')");
    expect(read('../chatgpt-auth.ts')).toContain("requestHeaders.get('x-orion-local-generation')");
  });
  it('preserves the unified destinations for referrals, account management and resumed encounters', () => {
    expect(read('../pathway/page.tsx')).toContain('<ClinicalRegistry mode="referrals"');
    expect(read('../access/page.tsx')).toContain('href="/clinical/team"');
    expect(read('../scheduling/page.tsx')).toContain("redirect('/crm?view=schedule')");
    expect(read('../live/page.tsx')).toContain("redirect('/clinical')");
    expect(read('./registry.tsx')).toContain('href={`/clinical?encounterId=${encodeURIComponent(item.id)}`}');
    expect(read('./page.tsx')).toContain('`/clinical?encounterId=${encodeURIComponent(selected)}`');
    expect(read('./encounter-workspace.tsx')).not.toContain('/clinical/patients');
  });
});
