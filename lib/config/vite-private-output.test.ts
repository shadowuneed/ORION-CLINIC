import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { excludePrivateEnvironmentAssets } from '../../scripts/vite-private-output';

it('removes plugin-generated preview credentials before disk output and preserves the local source file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orion-private-build-test-'));
  const canary = 'artificial generated preview credential';
  try {
    await writeFile(join(root, 'entry.js'), 'export const ready = true;');
    await writeFile(join(root, '.dev.vars'), canary);
    await build({ configFile: false, envFile: false, root, logLevel: 'silent',
      build: { outDir: join(root, 'dist'), lib: { entry: join(root, 'entry.js'), formats: ['es'], fileName: 'app' } },
      plugins: [
        { name: 'fixture-cloudflare-output', generateBundle() {
          this.emitFile({ type: 'asset', fileName: '.dev.vars', source: canary });
          this.emitFile({ type: 'asset', fileName: 'nested/.env.production', source: canary });
          this.emitFile({ type: 'asset', fileName: 'wrangler.json', source: '{"name":"fixture"}' });
        } },
        excludePrivateEnvironmentAssets(),
      ],
    });
    const files = await readdir(join(root, 'dist'), { recursive: true });
    expect(files).not.toContain('.dev.vars');
    expect(files.some(name => name.includes('.env'))).toBe(false);
    expect(files).toContain('wrangler.json');
    expect(await readFile(join(root, '.dev.vars'), 'utf8')).toBe(canary);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20_000);
