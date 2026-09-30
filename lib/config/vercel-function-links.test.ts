import { lstat, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { materializeVercelFunctionLinks } from '../../scripts/materialize-vercel-function-links.mjs';
import { checkDeploymentArtifact } from '../../scripts/check-deployment-artifact.mjs';

const aliases = [
  'functions/_global-error.segments/_full.segment.rsc.func',
  'functions/_global-error.segments/_global-error/__PAGE__.segment.rsc.func',
  'functions/_global-error.segments/_tree.segment.rsc.func',
];
const linkType = process.platform === 'win32' ? 'junction' : 'dir';

// Every file and alias is a generated test fixture, never a production artifact.
async function fixture(selected = aliases) {
  const parent = await mkdtemp(join(tmpdir(), 'orion-vercel-links-'));
  const root = join(parent, '.vercel/output');
  const target = join(root, 'functions/_global-error.func');
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'launcher.cjs'), 'module.exports = { generated: true };');
  await writeFile(join(target, '.vc-config.json'), '{"runtime":"nodejs24.x"}');
  for (const alias of selected) {
    const path = join(root, alias);
    await mkdir(dirname(path), { recursive: true });
    await symlink(target, path, linkType);
  }
  return { parent, root, target };
}

describe('bounded Vercel function directory alias materialization', () => {
  it('defaults to read-only dry-run and leaves all three aliases unchanged', async () => {
    const { root, target } = await fixture();
    const before = await readFile(join(target, 'launcher.cjs'), 'utf8');
    expect(await materializeVercelFunctionLinks(root)).toEqual({ files: 2, aliases, materialized: 0 });
    for (const alias of aliases) expect((await lstat(join(root, alias))).isSymbolicLink()).toBe(true);
    expect(await readFile(join(target, 'launcher.cjs'), 'utf8')).toBe(before);
    expect((await readdir(join(root, 'functions/_global-error.segments'))).some(name => name.startsWith('.orion-materialize-'))).toBe(false);
    expect((await checkDeploymentArtifact(root, { profile: 'vercel' })).safe).toBe(false);
  });
  it('materializes only approved aliases, preserves the function target, and becomes idempotent', async () => {
    const { root, target } = await fixture();
    const expected = await readFile(join(target, 'launcher.cjs'), 'utf8');
    expect((await materializeVercelFunctionLinks(root, { apply: true })).materialized).toBe(3);
    for (const alias of aliases) {
      const stat = await lstat(join(root, alias));
      expect(stat.isDirectory()).toBe(true);
      expect(stat.isSymbolicLink()).toBe(false);
      expect(await readFile(join(root, alias, 'launcher.cjs'), 'utf8')).toBe(expected);
    }
    expect(await readFile(join(target, 'launcher.cjs'), 'utf8')).toBe(expected);
    expect(await checkDeploymentArtifact(root, { profile: 'vercel' })).toEqual({ files: 8, findings: [], safe: true });
    expect(await materializeVercelFunctionLinks(root, { apply: true })).toEqual({ files: 8, aliases: [], materialized: 0 });
  });
  it('refuses unrelated aliases before modifying a confirmed one', async () => {
    const { root } = await fixture([aliases[0], 'functions/other.func']);
    await expect(materializeVercelFunctionLinks(root, { apply: true })).rejects.toThrow('other than confirmed');
    expect((await lstat(join(root, aliases[0]))).isSymbolicLink()).toBe(true);
  });
  it('refuses an external target without following or modifying it', async () => {
    const { root, parent } = await fixture([]);
    const outside = join(parent, 'outside');
    await mkdir(outside);
    const artificial = 'sb_secret_' + 'x'.repeat(30);
    await writeFile(join(outside, 'launcher.cjs'), artificial);
    const alias = join(root, aliases[0]);
    await mkdir(dirname(alias), { recursive: true });
    await symlink(outside, alias, linkType);
    await expect(materializeVercelFunctionLinks(root, { apply: true })).rejects.toThrow('confirmed internal function');
    expect((await lstat(alias)).isSymbolicLink()).toBe(true);
    expect(await readFile(join(outside, 'launcher.cjs'), 'utf8')).toBe(artificial);
  });
  it('refuses a different internal target even when harmless', async () => {
    const { root } = await fixture([]);
    const other = join(root, 'functions/other.func');
    await mkdir(other);
    await writeFile(join(other, 'launcher.cjs'), 'module.exports = {};');
    const alias = join(root, aliases[0]);
    await mkdir(dirname(alias), { recursive: true });
    await symlink(other, alias, linkType);
    await expect(materializeVercelFunctionLinks(root, { apply: true })).rejects.toThrow('confirmed internal function');
    expect((await lstat(alias)).isSymbolicLink()).toBe(true);
  });
  it.each(['.env.local', '.dev.vars', 'state.sqlite', 'package.zip'])('refuses %s anywhere in the target or dependencies', async name => {
    const { root, target } = await fixture([aliases[0]]);
    const path = join(target, 'node_modules/package', name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'artificial fixture');
    await expect(materializeVercelFunctionLinks(root, { apply: true })).rejects.toThrow('other than confirmed');
    expect((await lstat(join(root, aliases[0]))).isSymbolicLink()).toBe(true);
  });
  it('retains credential detection instead of copying an unsafe function target', async () => {
    const { root, target } = await fixture([aliases[0]]);
    const artificial = 'sb_secret_' + 'x'.repeat(30);
    await writeFile(join(target, 'launcher.cjs'), `module.exports = '${artificial}';`);
    await expect(materializeVercelFunctionLinks(root, { apply: true })).rejects.toThrow('other than confirmed');
    expect((await lstat(join(root, aliases[0]))).isSymbolicLink()).toBe(true);
  });
  it('refuses nested target links and linked output roots', async () => {
    const { root, target, parent } = await fixture([aliases[0]]);
    const outside = join(parent, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'launcher.cjs'), 'module.exports = {};');
    await symlink(outside, join(target, 'nested'), linkType);
    await expect(materializeVercelFunctionLinks(root, { apply: true })).rejects.toThrow('other than confirmed');
    const aliasParent = await mkdtemp(join(tmpdir(), 'orion-vercel-linked-root-'));
    await mkdir(join(aliasParent, '.vercel'));
    await symlink(root, join(aliasParent, '.vercel/output'), linkType);
    await expect(materializeVercelFunctionLinks(join(aliasParent, '.vercel/output'), { apply: true })).rejects.toThrow('unlinked');
  });
  it('requires the exact output shape and a boolean apply option', async () => {
    const { root, parent } = await fixture([]);
    await expect(materializeVercelFunctionLinks(parent, { apply: true })).rejects.toThrow('Vercel profile');
    await expect(materializeVercelFunctionLinks('')).rejects.toThrow('explicit');
    await expect(materializeVercelFunctionLinks(root, { apply: 'yes' } as never)).rejects.toThrow('boolean');
  });
  it('keeps CLI read-only unless --apply is explicitly passed', async () => {
    const { root } = await fixture([aliases[0]]);
    const script = fileURLToPath(new URL('../../scripts/materialize-vercel-function-links.mjs', import.meta.url));
    const dry = spawnSync(process.execPath, [script, '--dir', root], { encoding: 'utf8' });
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain('Dry-run only.');
    expect((await lstat(join(root, aliases[0]))).isSymbolicLink()).toBe(true);
    const invalid = spawnSync(process.execPath, [script, '--dir', root, '--force'], { encoding: 'utf8' });
    expect(invalid.status).toBe(2);
    expect((await lstat(join(root, aliases[0]))).isSymbolicLink()).toBe(true);
  });
});
