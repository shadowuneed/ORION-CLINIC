import { describe, expect, it } from 'vitest';
import { scanSourceBuffer } from '../../scripts/scan-secrets.mjs';
import { serviceRoleTokenOffsets } from '../../scripts/check-deployment-artifact.mjs';

describe('source secret scan coverage', () => {
  it.each(['accounts.html', 'public/accounts-reset-1234abcdef.html', 'server/ACCOUNTS.HTML.bak'])('blocks private account handoff %s even without key prefixes', name => {
    expect(scanSourceBuffer(name, Buffer.from('<table>artificial account handoff</table>'))).toEqual([{ filePath: name, line: 1, rule: 'private-account-handoff' }]);
  });
  it('cannot hide a token behind a NUL or the former four-megabyte cutoff', () => {
    const token = 'gsk_' + 'a'.repeat(30);
    for (const bytes of [Buffer.from(`\0${token}`), Buffer.from(`${' '.repeat(4 * 1024 * 1024 + 1)}${token}`)]) {
      const findings = scanSourceBuffer('client.js', bytes);
      expect(findings).toContainEqual({ filePath: 'client.js', line: 1, rule: 'groq-api-key' });
      expect(JSON.stringify(findings)).not.toContain(token);
    }
  });
  it('fails closed for unknown binary and encoding while preserving normal assets', () => {
    expect(scanSourceBuffer('client.js', Buffer.from('ordinary\0'))).toContainEqual({ filePath: 'client.js', line: 1, rule: 'uninspected-binary' });
    expect(scanSourceBuffer('client.js', Buffer.from([0xff, 0x80]))).toContainEqual({ filePath: 'client.js', line: 1, rule: 'uninspected-encoding' });
    expect(scanSourceBuffer('client.js', Buffer.from('const label = "Пациент";'))).toEqual([]);
    const font = Buffer.alloc(48); font.write('wOF2'); font.writeUInt32BE(font.length, 8);
    expect(scanSourceBuffer('font.woff2', font)).toEqual([]);
    expect(scanSourceBuffer('screenshot.png', Buffer.from([0xff, 0xd8, 0xff, 0, 0]))).toEqual([]);
    expect(scanSourceBuffer('screenshot.png', Buffer.from([0, 1, 2]))).toContainEqual({ filePath: 'screenshot.png', line: 1, rule: 'uninspected-binary' });
  });
  it('still detects credentials inside recognized assets and synthetic fixtures', () => {
    const token = 'sb_secret_' + 'b'.repeat(30);
    const font = Buffer.alloc(100); font.write('wOF2'); font.writeUInt32BE(font.length, 8); font.write(token, 48);
    for (const name of ['font.woff2', 'tests/fixtures/synthetic/fixture.bin']) {
      const findings = scanSourceBuffer(name, font);
      expect(findings).toContainEqual({ filePath: name, line: 1, rule: 'supabase-secret' });
      expect(JSON.stringify(findings)).not.toContain(token);
    }
  });
  it('detects privileged legacy JWT claims without confusing publishable or user claims', () => {
    const jwt = (role: string) => [Buffer.from('{"alg":"HS256"}').toString('base64url'), Buffer.from(JSON.stringify({ role })).toString('base64url'), 'artificial-signature'].join('.');
    for (const role of ['anon', 'authenticated']) expect(serviceRoleTokenOffsets(jwt(role))).toEqual([]);
    const token = jwt('service_role');
    expect(serviceRoleTokenOffsets(token)).toEqual([0]);
    const findings = scanSourceBuffer('client.js', Buffer.from(`// artificial\n${token}`));
    expect(findings).toContainEqual({ filePath: 'client.js', line: 2, rule: 'supabase-service-role' });
    expect(JSON.stringify(findings)).not.toContain(token);
  });
});
