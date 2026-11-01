import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer as createHttpServer } from 'node:http';
import { createServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPrivateHttpRequest, privateFileDenyPatterns, privateHttpFiles } from '../../scripts/private-http-paths';
import { localAccountAuth } from '../../scripts/local-account-auth';

const roots: string[] = [];
const servers: ViteDevServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
  // Only fixture directories allocated here are removed, never app state.
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('private runtime HTTP boundary', () => {
  it.each([
    '/.wrangler/state/v3/d1/fixture.sqlite', '/.wrangler/state/readme.txt',
    '/.orion-runtime/browser/session.json', '/backups/fixture.json', '/exports/fixture.txt',
    '/recordings/fixture.webm', '/artifacts/session.har', '/tmp/run.log', '/work/profile/Cookies',
    '/outputs/config.json', '/dist/server/config.json', '/.vinext/server-cache.js',
    '/accounts.html', '/ACCOUNTS.HTML', '/accounts-reset-1234abcdef.html', '/accounts.sqlite-wal', '/local-auth/fixture.txt',
    '/public/.env', '/public/.dev.vars.production', '/public/backups/fixture.json',
    '/.env?raw', '/.dev.vars.local?import', '/%2eenv', '/%252edev.vars',
    '/%2ewrangler%2fstate%2ffixture.json', '/%252ewrangler%255cstate%255cfixture.json',
    '/@fs/C:/clinic/.wrangler/state/fixture.json', '/@fs/C:/clinic/accounts.sqlite',
    '/@fs/C:/clinic/.orion-runtime/auth/session.json', '/.wrangler/../ordinary.txt',
    '/BACKUPS./fixture.txt', '/.wrangler%20/state/fixture.txt', '/.git/config',
    '/credentials.json.bak', '/auth.json.copy', '/id_ed25519', '/private.key',
    '/%00anything', '/malformed%2', '//outside.example/.env', 'http://outside.example/',
  ])('denies %s without opening it', target => {
    expect(isPrivateHttpRequest(target)).toBe(true);
  });

  it.each([
    '/', '/sign-in?return_to=%2Fcrm', '/crm', '/api/crm/snapshot',
    '/api/workspace/exports/download?id=fixture', '/api/recordings/status',
    '/app/clinic-shell.tsx', '/lib/auth/site-identity.ts', '/@vite/client',
    '/node_modules/vite/dist/client/client.mjs', '/images/patient-anatomy.png',
  ])('preserves %s', target => expect(isPrivateHttpRequest(target)).toBe(false));

  it('only permits current client optimizer JS, not metadata or other runtime state', () => {
    const root = resolve('fixture-clinic');
    const clientCacheDir = join(root, '.orion-runtime/vite-cache/serve-development-development');
    const options = { root, clientCacheDir };
    const prefix = '/.orion-runtime/vite-cache/serve-development-development/deps/';
    expect(isPrivateHttpRequest(`${prefix}react.js?v=123`, options)).toBe(false);
    expect(isPrivateHttpRequest(`${prefix}chunk-A123.js.map`, options)).toBe(false);
    expect(isPrivateHttpRequest(`/@fs/${clientCacheDir.replaceAll('\\', '/')}/deps/react.js`, options)).toBe(false);
    for (const suffix of ['_metadata.json', 'server/config.json', '../rsc/secret.js', 'react.js.old', 'session.sqlite']) {
      expect(isPrivateHttpRequest(`${prefix}${suffix}`, options)).toBe(true);
    }
    expect(isPrivateHttpRequest(prefix.replace('serve-development-development', 'other-mode') + 'react.js', options)).toBe(true);
    expect(isPrivateHttpRequest(`${prefix}react.js`, { root, clientCacheDir: resolve(root, '../outside') })).toBe(true);
  });

  it('blocks before reading accounts, even with forged headers or cookies', async () => {
    const load = vi.fn(async () => []);
    const next = vi.fn();
    const server = createHttpServer((request, response) => {
      void handle(request, response, () => { next(); response.end('public canary'); });
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Expected fixture port');
    const handle = localAccountAuth(address.port, load);
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/%252eenv`, { headers: {
        cookie: `orion_local_session=${'a'.repeat(64)}`, 'oai-authenticated-user-id': 'forged',
      } });
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toBe('');
      expect(load).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    } finally { await new Promise<void>(done => server.close(() => done())); }
  });

  it('blocks root, encoded, /@fs, ?raw and public canaries in an actual isolated Vite server', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orion-private-http-test-'));
    roots.push(root);
    const canary = 'harmless generated canary, not a credential';
    for (const name of ['.wrangler/state/probe.txt', 'backups/probe.txt', 'public/.env', 'public/accounts.html', 'public/probe.txt']) {
      await mkdir(join(root, name, '..'), { recursive: true });
      await writeFile(join(root, name), canary);
    }
    const server = await createServer({
      configFile: false, envFile: false, root, appType: 'custom', logLevel: 'silent',
      cacheDir: join(root, 'cache'), optimizeDeps: { noDiscovery: true, include: [] },
      server: { host: '127.0.0.1', port: 0, watch: null, fs: { deny: privateFileDenyPatterns } },
      plugins: [{ name: 'fixture-private-files', enforce: 'pre', configureServer(value) { value.middlewares.use(privateHttpFiles()); } }],
    });
    servers.push(server);
    await server.listen();
    const address = server.httpServer!.address(); if (!address || typeof address === 'string') throw new Error('Expected fixture port');
    const origin = `http://127.0.0.1:${address.port}`;
    expect(await (await fetch(`${origin}/probe.txt`)).text()).toBe(canary);
    for (const path of ['/.wrangler/state/probe.txt', '/%2ewrangler/state/probe.txt', '/backups/probe.txt?raw', '/.env', '/accounts.html', `/@fs/${root.replaceAll('\\', '/')}/.wrangler/state/probe.txt`]) {
      const response = await fetch(`${origin}${path}`);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain(canary);
    }
  }, 20_000);
});
