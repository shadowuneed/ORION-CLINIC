import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { ESLint } from 'eslint';
import type { ConfigEnv, UserConfig } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Inspect the actual config factories without starting a server, reading secrets,
// loading Wrangler state or touching a running dependency optimizer.
vi.mock('vite', () => ({ defineConfig: <T>(config: T) => config }));
vi.mock('vinext', () => ({ default: () => ({ name: 'vinext-test' }) }));
vi.mock('@openai/sites-vite-plugin', () => ({ sites: () => ({ name: 'sites-test' }) }));
vi.mock('@tailwindcss/postcss', () => ({ default: () => ({ postcssPlugin: 'tailwind-test' }) }));
const { cloudflareMock } = vi.hoisted(() => ({
  cloudflareMock: vi.fn((options: unknown) => ({ name: 'cloudflare-test', options })),
}));
vi.mock('@cloudflare/vite-plugin', () => ({ cloudflare: cloudflareMock }));

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
  cloudflareMock.mockClear();
  for (const name of ['WRANGLER_WRITE_LOGS', 'WRANGLER_LOG_PATH', 'MINIFLARE_REGISTRY_PATH']) {
    vi.stubEnv(name, process.env[name]);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Vite runtime cache isolation', () => {
  it.each(['production', 'development', 'test'])('excludes local preview secrets from every build mode: %s', async (mode) => {
    await mainConfig('build', mode);
    expect(cloudflareMock).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ secrets: { required: [] } }),
    }));
  });

  it.each([['development', false], ['test', false], ['development', true]] as const)('does not change local serving secret resolution: %s preview=%s', async (mode, isPreview) => {
    await mainConfig('serve', mode, isPreview);
    const options = cloudflareMock.mock.calls[0]?.[0] as { config: { secrets?: unknown } } | undefined;
    expect(options).toBeDefined();
    expect(options?.config).not.toHaveProperty('secrets');
  });

  it('uses the installed Wrangler allowlist to omit an artificial local secret from build preview variables', async () => {
    // Only this disposable fixture is read, never the checkout's local credentials.
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'orion-build-secret-filter-'));
    const fixtureConfig = join(fixtureRoot, 'wrangler.jsonc');
    const artificial = 'fixture-' + 'x'.repeat(30);
    await writeFile(fixtureConfig, '{}');
    await writeFile(join(fixtureRoot, '.dev.vars'), `ORION_BUILD_FILTER_KEY=${artificial}\n`);
    const { unstable_getVarsForDev } = await import('wrangler');
    expect(unstable_getVarsForDev(fixtureConfig, undefined, {}, undefined, true, { required: [] })).toEqual({});
    expect(unstable_getVarsForDev(fixtureConfig, undefined, {}, undefined, true, { required: ['ORION_BUILD_FILTER_KEY'] }))
      .toEqual({ ORION_BUILD_FILTER_KEY: { type: 'secret_text', value: artificial } });
  }, 30_000);

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
