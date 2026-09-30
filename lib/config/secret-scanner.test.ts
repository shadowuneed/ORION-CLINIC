import { describe, expect, it } from 'vitest';
import { scanRepositoryText } from '../../scripts/scan-secrets.mjs';

const passwordName = 'pass' + 'word';
const tokenName = 'to' + 'ken';

describe('syntax-aware sensitive assignment scanning', () => {
  it.each([
    `const login = schema.extend({ ${passwordName}: z.string().min(1).max(1024) });`,
    `const ${tokenName} = randomBytes(32).toString('base64url');`,
    `const grant = { ${passwordName}: parsed.data.password };`,
    `let ${tokenName} = cloudCookie(headers, cloudAuthCookies.access);`,
    `let ${tokenName}; ${tokenName} = request.headers.get('cookie');`,
    `const ${passwordName} = process.env['ORION_PASSWORD'];`,
  ])('recognizes parsed dynamic assignments without exempting the variable or file', source => {
    expect(scanRepositoryText('lib/auth-fixture.ts', source)).toEqual([]);
  });
  it.each(['.ts', '.js', '.mjs', '.env', '.md'])('still rejects literal credentials in %s', extension => {
    const artificial = 'q'.repeat(30);
    const source = `const ${passwordName} = '${artificial}';`;
    const findings = scanRepositoryText(`lib/auth-fixture${extension}`, source);
    expect(findings).toContainEqual({ filePath: `lib/auth-fixture${extension}`, line: 1, rule: 'sensitive-assignment' });
    expect(JSON.stringify(findings)).not.toContain(artificial);
  });
  it('does not skip literal-bearing call, concatenation or conditional expressions', () => {
    const artificial = 'q'.repeat(30);
    for (const expression of [`readCredentialFromSource('${artificial}')`, `'${artificial}' + suffix`, `credentialCondition ? '${artificial}' : fallback`]) {
      const findings = scanRepositoryText('lib/auth-fixture.ts', `const ${passwordName} = ${expression};`);
      expect(findings.some(finding => finding.rule === 'sensitive-assignment')).toBe(true);
      expect(JSON.stringify(findings)).not.toContain(artificial);
    }
  });
  it('does not interpret documentation, malformed source or unsupported syntax as a dynamic exemption', () => {
    const source = `const ${tokenName} = randomBytes(32).toString('base64url');`;
    expect(scanRepositoryText('docs/auth-fixture.md', source).some(finding => finding.rule === 'sensitive-assignment')).toBe(true);
    expect(scanRepositoryText('lib/auth-fixture.ts', `${source}\nfunction broken(`).some(finding => finding.rule === 'sensitive-assignment')).toBe(true);
    expect(scanRepositoryText('lib/auth-fixture.ts', `const ${tokenName} = (credentialCondition ? candidate : fallback);`).some(finding => finding.rule === 'sensitive-assignment')).toBe(true);
  });
  it('does not suppress known credential patterns inside otherwise dynamic expressions', () => {
    const artificial = 'sb_secret_' + 'x'.repeat(30);
    const findings = scanRepositoryText('lib/auth-fixture.ts', `const ${tokenName} = readCredentialFromSource('${artificial}');`);
    expect(findings.some(finding => finding.rule === 'supabase-secret-key')).toBe(true);
    expect(JSON.stringify(findings)).not.toContain(artificial);
  });
  it.each([
    (value: string) => `String('${value}')`,
    (value: string) => `String(\`${value}\`)`,
    (value: string) => `['${value}']`,
    (value: string) => `String(['${value}'])`,
    (value: string) => `['${value.slice(0, 10)}', '${value.slice(10)}'].join('')`,
    (value: string) => `'${value.slice(0, 10)}' + '${value.slice(10)}'`,
    (value: string) => `String(\`\${'${value}'}\`)`,
    (value: string) => `String(\`${value}\${inputValue}\`)`,
  ])('detects literal credentials even when the regex RHS prefix is short', expression => {
    const artificial = 'q'.repeat(30);
    const name = 'API' + '_KEY';
    const findings = scanRepositoryText('lib/auth-fixture.ts', `const ${name} = ${expression(artificial)};`);
    expect(findings).toContainEqual({ filePath: 'lib/auth-fixture.ts', line: 1, rule: 'sensitive-assignment' });
    expect(JSON.stringify(findings)).not.toContain(artificial);
  });
  it('rejects a literal-secret wrapped in String, not only known token formats', () => {
    const name = 'API' + '_KEY';
    expect(scanRepositoryText('lib/fixture.ts', `const ${name} = String('literal-secret');`).some(finding => finding.rule === 'sensitive-assignment')).toBe(true);
  });
  it('recognizes only exact confirmed synthetic markers and global Symbol values', () => {
    const unicodeFixture = 'Только искусственный пароль 🧪';
    expect(scanRepositoryText('lib/fixture.ts', `const ${passwordName} = '${unicodeFixture}';`)).toEqual([]);
    expect(scanRepositoryText('lib/fixture.ts', `let ${tokenName} = Symbol('unbound-target');`)).toEqual([]);
    const fakeJwt = `const ${tokenName} = \`example.\${encode({ session_id: '11111111-1111-4111-8111-111111111111' })}.example\`;`;
    expect(scanRepositoryText('lib/fixture.ts', fakeJwt)).toEqual([]);
    expect(scanRepositoryText('lib/fixture.ts', `const ${passwordName} = 'Только искусственный пароль для рабочего входа';`).some(finding => finding.rule === 'sensitive-assignment')).toBe(true);
    expect(scanRepositoryText('lib/fixture.ts', `function Symbol(value) { return value; } const ${tokenName} = Symbol('unbound-target');`).some(finding => finding.rule === 'sensitive-assignment')).toBe(true);
  });
});
