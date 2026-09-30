import { mkdtemp, mkdir, writeFile, symlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { checkDeploymentArtifact } from '../../scripts/check-deployment-artifact.mjs';

// All fixture material is generated and artificial; no local secrets are opened.
async function fixture(files: Record<string, string | Buffer>) {
  const root = await mkdtemp(join(tmpdir(), 'orion-artifact-test-'));
  for (const [name, value] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, value);
  }
  return root;
}

describe('deployment artifact safety boundary', () => {
  it('accepts ordinary generated web assets', async () => {
    expect(await checkDeploymentArtifact(await fixture({ 'index.html': '<main>ORION</main>', 'assets/app.js': 'export const ready = true;' })))
      .toEqual({ files: 2, findings: [], safe: true });
  });
  it.each(['.dev.vars', '.dev.vars.production', '.env', '.env.local', 'auth.json', 'state.sqlite', 'state.db-wal', 'audio.webm', 'server.log'])('blocks private artifact %s regardless of value', async name => {
    const result = await checkDeploymentArtifact(await fixture({ [`server/${name}`]: 'artificial fixture' }));
    expect(result.safe).toBe(false);
    expect(result.findings).toContainEqual({ path: `server/${name}`, rule: 'private-file' });
  });
  it('blocks a secret directory even with harmless contents', async () => {
    const result = await checkDeploymentArtifact(await fixture({ '.wrangler/state/fixture.txt': 'artificial' }));
    expect(result.findings).toContainEqual({ path: '.wrangler', rule: 'private-directory' });
  });
  it('detects a bundled token without returning any matched value', async () => {
    const artificial = 'gsk_' + 'a'.repeat(30);
    const result = await checkDeploymentArtifact(await fixture({ 'assets/client.js': `const key = '${artificial}';` }));
    expect(result.findings).toEqual([{ path: 'assets/client.js', rule: 'groq-key' }]);
    expect(JSON.stringify(result)).not.toContain(artificial);
  });
  it('fails closed for an empty or nonexistent artifact', async () => {
    const root = await fixture({});
    expect((await checkDeploymentArtifact(root)).safe).toBe(false);
    await expect(checkDeploymentArtifact(join(root, 'missing'))).rejects.toThrow();
  });
  it.each(['auth.json.bak', 'auth.json.copy', 'auth.json.2026-09-24', 'dev.vars.bak', 'dev.vars.production', '.env.old~', '.npmrc', '.netrc', 'id_ed25519', 'credentials.json', 'patient.pdf', 'patient.docx', 'backup.zip', 'app.js.gz', 'app.js.br', 'state.sqlite.old'])('blocks private copies and containers: %s', async name => {
    const result = await checkDeploymentArtifact(await fixture({ [`server/${name}`]: 'artificial fixture' }));
    expect(result.findings).toContainEqual({ path: `server/${name}`, rule: 'private-file' });
    expect(result.safe).toBe(false);
  });
  it('does not let a NUL suppress token inspection', async () => {
    const artificial = 'gsk_' + 'a'.repeat(30);
    const result = await checkDeploymentArtifact(await fixture({ 'app.js': `\0 const key = '${artificial}';` }));
    expect(result.findings).toContainEqual({ path: 'app.js', rule: 'groq-key' });
    expect(result.findings).toContainEqual({ path: 'app.js', rule: 'uninspected-binary' });
    expect(JSON.stringify(result)).not.toContain(artificial);
  });
  it.each([
    ['UTF-16', Buffer.from('const secret = "artificial";', 'utf16le'), 'uninspected-binary'],
    ['invalid UTF-8', Buffer.from([0x61, 0x80, 0x62]), 'uninspected-encoding'],
    ['unknown binary', Buffer.from([0, 1, 2, 3]), 'uninspected-binary'],
  ])('rejects uninspected %s', async (_name, bytes, rule) => {
    const result = await checkDeploymentArtifact(await fixture({ 'app.js': bytes as Buffer }));
    expect(result.findings).toContainEqual({ path: 'app.js', rule });
    expect(result.safe).toBe(false);
  });
  it.each([
    ['gzip', gzipSync('artificial')],
    ['zip', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0])],
    ['pdf', Buffer.from('%PDF-1.7\nartificial')],
    ['sqlite', Buffer.from('SQLite format 3\0artificial')],
    ['7zip', Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])],
  ])('rejects a renamed %s container', async (_name, bytes) => {
    const result = await checkDeploymentArtifact(await fixture({ 'assets/app.js': bytes }));
    expect(result.findings).toContainEqual({ path: 'assets/app.js', rule: 'uninspected-container' });
    expect(result.safe).toBe(false);
  });
  it('preserves ordinary UTF-8/Cyrillic assets and checked WOFF2 headers', async () => {
    const font = Buffer.alloc(48);
    font.write('wOF2');
    font.writeUInt32BE(font.length, 8);
    const result = await checkDeploymentArtifact(await fixture({ 'assets/font.woff2': font, '_headers': '/*\n  Cache-Control: no-store', 'index.html': '<main>Инструкция ORION</main>' }));
    expect(result).toEqual({ files: 3, findings: [], safe: true });
  });
  it('does not whitelist a binary solely by its filename or truncated signature', async () => {
    const result = await checkDeploymentArtifact(await fixture({ 'fake.png': Buffer.from([0, 1, 2]), 'fake.woff2': Buffer.from('wOF2\0'), 'mismatch.woff2': Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(60)]) }));
    expect(result.safe).toBe(false);
    expect(result.findings).toHaveLength(3);
  });
  it('still scans token bytes in recognized binary assets', async () => {
    const artificial = 'gsk_' + 'b'.repeat(30);
    const font = Buffer.alloc(100);
    font.write('wOF2'); font.writeUInt32BE(font.length, 8); font.write(artificial, 48);
    const result = await checkDeploymentArtifact(await fixture({ 'font.woff2': font }));
    expect(result.findings).toEqual([{ path: 'font.woff2', rule: 'groq-key' }]);
    expect(JSON.stringify(result)).not.toContain(artificial);
  });
  it('rejects private storage as root or ancestor before scanning', async () => {
    const root = await fixture({ '.wrangler/state/assets/app.js': 'export const ready = true;' });
    await expect(checkDeploymentArtifact(join(root, '.wrangler'))).rejects.toThrow('Private storage');
    await expect(checkDeploymentArtifact(join(root, '.wrangler/state/assets'))).rejects.toThrow('Private storage');
  });
  it('rejects linked root and linked ancestors without inspecting the target', async () => {
    const target = await fixture({ 'nested/app.js': 'export const ready = true;' });
    const root = await fixture({});
    await symlink(target, join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(checkDeploymentArtifact(join(root, 'alias'))).rejects.toThrow('unlinked');
    await expect(checkDeploymentArtifact(join(root, 'alias/nested'))).rejects.toThrow('unlinked');
  });
  it('blocks links inside the artifact instead of following them', async () => {
    const target = await fixture({ 'app.js': 'export const ready = true;' });
    const root = await fixture({ 'index.html': '<main>ORION</main>' });
    await symlink(target, join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    expect((await checkDeploymentArtifact(root)).findings).toContainEqual({ path: 'alias', rule: 'unresolved-link' });
  });
  it('requires an explicit nonempty directory', async () => {
    await expect(checkDeploymentArtifact('')).rejects.toThrow('explicit');
    await expect(checkDeploymentArtifact(' ')).rejects.toThrow('explicit');
  });
  it('offers an explicit post-build artifact gate without changing the local build', async () => {
    const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.scripts['security:artifact']).toBe('node scripts/check-deployment-artifact.mjs');
    expect(pkg.scripts['build:deploy-check']).toBe('pnpm build && node scripts/check-deployment-artifact.mjs --dir dist');
    expect(pkg.scripts.build).toBe('node scripts/build-user-handbook.mjs && vinext build');
  });
});
