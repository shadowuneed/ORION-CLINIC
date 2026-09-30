import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { ESLint } from 'eslint';
import type { ConfigEnv, UserConfig } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Inspect the actual config factories without starting a server, reading secrets,
// loading Wrangler state or touching a running dependency optimizer.
vi.mock('vite', () => ({ defineConfig: <T>(config: T) => config }));
vi.mock('vinext', () => ({ default: () => ({ name: 'vinext-test' }) }));
vi.mock('@openai/sites-vite-plugin', () => ({ sites: () => ({ name: 'sites-test' }) }));
vi.mock('@tailwindcss/postcss', () => ({ default: () => ({ postcssPlugin: 'tailwind-test' }) }));
vi.mock('@cloudflare/vite-plugin', () => ({ cloudflare: () => ({ name: 'cloudflare-test' }) }));

const root = fileURLToPath(new URL('../../', import.meta.url));
type ConfigFactory = (environment: ConfigEnv) => Promise<UserConfig>;

async function mainConfig(command: ConfigEnv['command'], mode: string, isPreview = false) {
  const { default: factory } = await import('../../vite.config');
  return (factory as ConfigFactory)({ command, mode, isPreview });
}

async function personaConfig(command: ConfigEnv['command'] = 'serve', mode = 'test') {
  const { default: factory } = await import('../../vite.personas.config');
  return (factory as ConfigFactory)({ command, mode });
}

beforeEach(() => {
  for (const name of ['WRANGLER_WRITE_LOGS', 'WRANGLER_LOG_PATH', 'MINIFLARE_REGISTRY_PATH']) {
    vi.stubEnv(name, process.env[name]);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Vite runtime cache isolation', () => {
  it('separates serve, build and preview even when mode and NODE_ENV are identical', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const dev = await mainConfig('serve', 'development');
    const build = await mainConfig('build', 'development');
    const preview = await mainConfig('serve', 'development', true);
    expect(new Set([dev.cacheDir, build.cacheDir, preview.cacheDir]).size).toBe(3);
    const cachePlugins = [dev, build, preview].map((config) =>
      config.plugins?.find((plugin) => plugin && typeof plugin === 'object' && 'name' in plugin && plugin.name.startsWith('orion-cache-v1-')));
    expect(cachePlugins.every(Boolean)).toBe(true);
    expect(new Set(cachePlugins.map((plugin) => (plugin as { name: string }).name)).size).toBe(3);
    for (const cacheDir of [dev.cacheDir, build.cacheDir, preview.cacheDir]) {
      expect(isAbsolute(cacheDir!)).toBe(true);
      expect(relative(resolve(root, '.orion-runtime/vite-cache'), cacheDir!)).not.toMatch(/^\.\./);
      expect(cacheDir).not.toContain('node_modules');
    }
  });

  it('keeps a deterministic cache per mode and separates production transforms', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const first = await mainConfig('serve', 'development');
    expect((await mainConfig('serve', 'development')).cacheDir).toBe(first.cacheDir);
    expect((await mainConfig('serve', 'production')).cacheDir).not.toBe(first.cacheDir);
    vi.stubEnv('NODE_ENV', 'production');
    expect((await mainConfig('serve', 'development')).cacheDir).not.toBe(first.cacheDir);
    expect((await mainConfig('build', 'production')).cacheDir).not.toBe(first.cacheDir);
  });

  it('contains custom mode names inside the cache root', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const config = await mainConfig('serve', '../../outside\\nested');
    const pathFromCacheRoot = relative(resolve(root, '.orion-runtime/vite-cache'), config.cacheDir!);
    expect(isAbsolute(pathFromCacheRoot)).toBe(false);
    expect(pathFromCacheRoot).not.toMatch(/^\.\./);
    expect(pathFromCacheRoot).toContain('%2F');
    expect(pathFromCacheRoot).toContain('%5C');
  });

  it('does not watch build, cache or isolated verification artifacts', async () => {
    const config = await mainConfig('serve', 'development');
    expect(config.server?.watch && config.server.watch.ignored).toEqual(expect.arrayContaining([
      '**/.orion-runtime/**', '**/dist/**', '**/.vinext/**', '**/work/**', '**/outputs/**',
    ]));
  });

  it('excludes generated runtime caches from lint and typecheck inputs', async () => {
    const eslint = new ESLint({ cwd: root });
    expect(await eslint.isPathIgnored(resolve(root, '.orion-runtime/vite-cache/serve-development-development/deps/react.js'))).toBe(true);
    const tsconfig = JSON.parse(readFileSync(resolve(root, 'tsconfig.json'), 'utf8')) as { exclude: string[] };
    expect(tsconfig.exclude).toContain('.orion-runtime');
    // Loading the real Next ESLint config can be slow during a full-suite cold start.
  }, 90_000);

  it('keeps persona caches in their isolated run root and apart from the primary runtime', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('ORION_PERSONA_TEST', '1');
    vi.stubEnv('ORION_PERSONA_PORT', '3213');
    vi.stubEnv('ORION_PERSONA_ROOT', resolve(root, 'work/personas/cache-regression-a'));
    const first = await personaConfig();
    expect(first.plugins).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'orion-persona-cache-v1-serve-test-test' })]));
    expect(first.cacheDir).toBe(resolve(root, 'work/personas/cache-regression-a/vite-cache/serve-test-test'));
    expect(first.cacheDir).not.toBe((await mainConfig('serve', 'test')).cacheDir);
    vi.stubEnv('ORION_PERSONA_ROOT', resolve(root, 'work/personas/cache-regression-b'));
    expect((await personaConfig()).cacheDir).not.toBe(first.cacheDir);
    expect(first.server?.watch && first.server.watch.ignored).toEqual(expect.arrayContaining(['**/dist/**']));
  });

  it('still rejects persona production/build use and non-isolated run directories', async () => {
    vi.stubEnv('ORION_PERSONA_TEST', '1');
    vi.stubEnv('ORION_PERSONA_PORT', '3213');
    vi.stubEnv('ORION_PERSONA_ROOT', resolve(root, 'work/personas/cache-regression'));
    await expect(personaConfig('build')).rejects.toThrow('only for explicit local test serving');
    await expect(personaConfig('serve', 'production')).rejects.toThrow('only for explicit local test serving');
    vi.stubEnv('ORION_PERSONA_ROOT', root);
    await expect(personaConfig()).rejects.toThrow('Isolated persona run directory required');
  });
});
