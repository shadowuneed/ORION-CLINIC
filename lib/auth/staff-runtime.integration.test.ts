import { randomUUID, X509Certificate } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { Agent, request as httpsRequest } from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { D1StaffCredentialRepository } from '../repositories/staff-credentials';
import { hashStaffPassword } from './staff-password';

/**
 * Actual local workerd + D1 + HTTPS, NOT a mocked D1 adapter, browser acceptance,
 * clinical authorization, production deployment or Workers load/capacity test.
 * No Wrangler/Vite configuration or environment-file loaders are imported.
 * Only this disposable synthetic fixture uses the public bundled development CA;
 * it must never be installed in browser/system trust or used for real credentials.
 */
type LocalRuntime = {
  ready: Promise<URL>;
  getD1Database(binding: string): Promise<D1Database>;
  dispose(): Promise<void>;
};
type LocalMiniflare = {
  Miniflare: new (options: unknown) => LocalRuntime;
  convertV4MiniflareOptions(options: Record<string, unknown>): unknown;
  Log: new (level: number) => unknown;
  LogLevel: { ERROR: number };
};
type LocalBuilder = {
  build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }>;
};
type HttpResult = { status: number; headers: IncomingHttpHeaders; body: string };

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const requireInstalled = createRequire(join(repositoryRoot, 'package.json'));
const requireWrangler = createRequire(requireInstalled.resolve('wrangler/package.json'));
const fixturePrefix = 'orion-staff-tls-';
const issuer = 'orion:isolated-staff-verification';
const staff = [
  { id: 'synthetic-user-a', subject: 'synthetic-external-a', login: 'synthetic.clinician.a', name: 'Synthetic A <script>not executable</script>' },
  { id: 'synthetic-user-b', subject: 'synthetic-external-b', login: 'synthetic.clinician.b', name: 'Synthetic B' },
] as const;

function runtimeEnvironment(): Record<string, string> {
  // Miniflare merges these with process.env. Explicitly blank every inherited
  // name, then retain OS execution paths only; never inspect provider key values.
  const clean = Object.fromEntries(Object.keys(process.env).map(name => [name, '']));
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']) {
    if (process.env[name] !== undefined) clean[name] = process.env[name]!;
  }
  return clean;
}

async function reserveLoopbackPort(): Promise<number> {
  // Close the reservation before launch. A bind race must fail startup, not select
  // a different host/port or derive a trusted origin from an incoming request.
  const server = createServer();
  await new Promise<void>((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveReady());
  });
  const address = server.address();
  await new Promise<void>((resolveClosed, reject) => server.close(error => error ? reject(error) : resolveClosed()));
  if (address === null || typeof address === 'string' || [3101, 3200].includes(address.port)) {
    throw new Error('No isolated loopback port');
  }
  return address.port;
}

async function bundledPublicCertificate(): Promise<string> {
  // The API has no certificate getter. Pin the installed implementation before
  // extracting ONLY its public CERT constant (never KEY) without printing it.
  const versions = [
    ['miniflare', '5.20260826.0-alpha'],
    ['workerd', '1.20260826.1'],
    ['esbuild', '0.28.1'],
  ];
  for (const [name, expected] of versions) {
    const metadata = requireWrangler(`${name}/package.json`) as { version?: unknown };
    if (metadata.version !== expected) throw new Error('Review isolated TLS fixture after dependency upgrade');
  }
  const source = await readFile(requireWrangler.resolve('miniflare'), 'utf8');
  const match = /var CERT = `\s*(-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----)\s*`;/u.exec(source);
  if (!match) throw new Error('Installed public development certificate was not found');
  const certificate = new X509Certificate(match[1]);
  if (!certificate.ca || !certificate.verify(certificate.publicKey)
    || !certificate.checkHost('localhost') || !certificate.checkIP('127.0.0.1')
    || Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) {
    throw new Error('Installed public development certificate is not valid for loopback');
  }
  return match[1];
}

describe('isolated staff runtime over verified loopback TLS and actual workerd D1', () => {
  let runtime: LocalRuntime | undefined;
  let library: LocalMiniflare;
  let fixtureDirectory: string | undefined;
  let fixtureParent: string;
  let origin: string;
  let port: number;
  let workerBundle: string;
  let trustedAgent: Agent;
  const databaseId = randomUUID();
  // Random test credentials exist in memory only and are never fixture files/logs.
  const syntheticPasswords = staff.map(() => `Synthetic-only-${randomUUID()}`);

  async function startRuntime() {
    if (!fixtureDirectory) throw new Error('Missing isolated fixture directory');
    runtime = new library.Miniflare(library.convertV4MiniflareOptions({
      host: '127.0.0.1', port, https: true,
      resourcePersistencePath: join(fixtureDirectory, 'state'),
      resourceTmpPath: join(fixtureDirectory, 'runtime'),
      unsafeDevRegistryPath: join(fixtureDirectory, 'registry'),
      unsafeRuntimeEnv: runtimeEnvironment(),
      cf: false, telemetry: { enabled: false }, log: new library.Log(library.LogLevel.ERROR),
      workers: [{
        name: 'orion-isolated-staff-tls', modules: true, script: workerBundle,
        compatibilityDate: '2026-05-22', compatibilityFlags: ['nodejs_compat'],
        bindings: { STAFF_ORIGIN: origin }, d1Databases: { DB: databaseId },
        // No application/provider network traffic is allowed by this harness.
        outboundService: () => new Response(null, { status: 503 }),
      }],
    }));
    const bound = await runtime.ready;
    expect(bound.origin === origin, 'runtime must bind the preconfigured loopback origin').toBe(true);
  }

  function request(path: string, options: {
    method?: string; headers?: Record<string, string>; body?: string;
    agent?: Agent | false; servername?: string;
  } = {}): Promise<HttpResult> {
    return new Promise((resolveResponse, reject) => {
      const outgoing = httpsRequest(new URL(path, origin), {
        method: options.method ?? 'GET', agent: options.agent ?? trustedAgent,
        rejectUnauthorized: true, servername: options.servername ?? 'localhost',
        headers: options.headers,
      }, incoming => {
        const chunks: Buffer[] = [];
        let size = 0;
        incoming.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 32 * 1024) incoming.destroy(new Error('Unexpected fixture response size'));
          else chunks.push(chunk);
        });
        incoming.once('error', reject);
        incoming.once('end', () => resolveResponse({
          status: incoming.statusCode ?? 0, headers: incoming.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      });
      outgoing.setTimeout(15_000, () => outgoing.destroy(new Error('Isolated HTTPS request timed out')));
      outgoing.once('error', reject);
      outgoing.end(options.body);
    });
  }

  async function tlsFailure(options: { agent?: Agent | false; servername?: string }): Promise<string> {
    try { await request('/sign-in', options); return 'unexpected-success'; }
    catch (error) { return (error as NodeJS.ErrnoException).code ?? 'unknown-tls-error'; }
  }

  function post(body?: unknown, cookie?: string) {
    return {
      method: 'POST',
      headers: {
        Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
  }

  function sessionCookie(result: HttpResult): string {
    const cookies = result.headers['set-cookie'];
    expect(cookies?.length, 'one staff cookie, never raw token in response body').toBe(1);
    const full = cookies![0];
    expect(/^__Host-orion_staff_session=[a-f0-9]{64};/.test(full), 'opaque host cookie format').toBe(true);
    for (const flag of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/']) {
      expect(full.includes(flag), `required cookie flag ${flag}`).toBe(true);
    }
    expect(/; Expires=/i.test(full), 'absolute cookie expiry is present').toBe(true);
    expect(/(?:^|;)\s*Domain=/i.test(full), 'no Domain attribute').toBe(false);
    expect(result.body.length).toBe(0);
    return full.split(';')[0];
  }

  function privateResponse(result: HttpResult) {
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['x-content-type-options']).toBe('nosniff');
  }

  async function currentIdentity(index: number, cookie: string) {
    const person = staff[index];
    const forged = {
      Cookie: cookie, 'oai-authenticated-user-id': staff[1 - index].subject,
      'oai-authenticated-user-name': 'Forged Sites identity',
      'x-forwarded-user': staff[1 - index].id,
    };
    const api = await request('/api/staff/session', { headers: forged });
    expect(api.status).toBe(200);
    privateResponse(api);
    const expected = {
      user: { id: person.id, displayName: person.name, email: null },
      principal: { issuer, subject: person.subject, email: null },
    };
    // Compare a boolean so a failing assertion cannot print session rows/tokens.
    expect(JSON.stringify(JSON.parse(api.body)) === JSON.stringify(expected), 'minimal exact durable identity').toBe(true);
    const page = await request('/staff', { headers: forged });
    expect(page.status).toBe(200);
    privateResponse(page);
    expect(page.body.includes(`data-staff-user-id="${person.id}"`)).toBe(true);
    expect(page.body.includes(`data-staff-issuer="${issuer}"`)).toBe(true);
    expect(page.body.includes(`data-staff-subject="${person.subject}"`)).toBe(true);
    expect(page.body.includes('<script>not executable</script>')).toBe(false);
    if (index === 0) expect(page.body.includes('&lt;script&gt;not executable&lt;/script&gt;')).toBe(true);
    expect(page.body.includes(cookie)).toBe(false);
  }

  beforeAll(async () => {
    // Refuse runtime/debug overrides rather than reading their possibly sensitive
    // values or silently executing an arbitrary workerd binary/configuration.
    if (Object.keys(process.env).some(name => /^MINIFLARE_(?:WORKERD|AUTOGATES|V8_FLAGS)/.test(name))) {
      throw new Error('Unset Miniflare runtime overrides before isolated verification');
    }
    const publicCertificate = await bundledPublicCertificate();
    trustedAgent = new Agent({ ca: publicCertificate, rejectUnauthorized: true, keepAlive: false });
    library = requireWrangler('miniflare') as LocalMiniflare;
    const builder = requireWrangler('esbuild') as LocalBuilder;
    const bundled = await builder.build({
      stdin: {
        contents: `
          import { createStaffVerificationRuntime } from './lib/auth/staff-runtime.ts';
          import { D1StaffCredentialRepository } from './lib/repositories/staff-credentials.ts';
          import { D1StaffSessionRepository } from './lib/repositories/staff-sessions.ts';
          export default { fetch(request, env) {
            return createStaffVerificationRuntime({
              credentials: new D1StaffCredentialRepository(env.DB),
              sessions: new D1StaffSessionRepository(env.DB),
            }, { origin: env.STAFF_ORIGIN })(request);
          } };
        `,
        resolveDir: repositoryRoot, sourcefile: 'orion-isolated-staff-worker.ts', loader: 'ts',
      },
      bundle: true, write: false, format: 'esm', platform: 'neutral',
      mainFields: ['module', 'main'], external: ['node:*'],
      tsconfig: join(repositoryRoot, 'tsconfig.json'), logLevel: 'silent',
    });
    workerBundle = bundled.outputFiles[0].text;
    fixtureParent = await realpath(tmpdir());
    fixtureDirectory = await mkdtemp(join(fixtureParent, fixturePrefix));
    port = await reserveLoopbackPort();
    origin = `https://127.0.0.1:${port}`;
    await startRuntime();
    const database = await runtime!.getD1Database('DB');
    const migrations = (await readdir(join(repositoryRoot, 'drizzle'))).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
    expect(migrations.includes('0048_staff_sessions.sql') && migrations.includes('0049_staff_credentials.sql')).toBe(true);
    for (const migration of migrations) {
      const statements = (await readFile(join(repositoryRoot, 'drizzle', migration), 'utf8'))
        .split('--> statement-breakpoint').map(sql => sql.trim()).filter(Boolean);
      await database.batch(statements.map(sql => database.prepare(sql)));
    }
    await database.batch([
      database.prepare('insert into organizations (id, name) values (?, ?)').bind('tls-org', 'Synthetic TLS organization'),
      database.prepare('insert into facilities (id, organization_id, name) values (?, ?, ?)').bind('tls-facility', 'tls-org', 'Synthetic TLS facility'),
      database.prepare("insert into users (id, external_issuer, external_subject, display_name, status) values (?, ?, ?, ?, 'active')")
        .bind('synthetic-operator', issuer, 'synthetic-operator-subject', 'Synthetic fixture operator'),
      ...staff.map(person => database.prepare("insert into users (id, external_issuer, external_subject, display_name, status) values (?, ?, ?, ?, 'active')")
        .bind(person.id, issuer, person.subject, person.name)),
      ...staff.map(person => database.prepare("insert into memberships (id, organization_id, facility_id, user_id, role) values (?, 'tls-org', 'tls-facility', ?, 'clinician')")
        .bind(`membership-${person.id}`, person.id)),
    ]);
    const credentials = new D1StaffCredentialRepository(database);
    for (const [index, person] of staff.entries()) {
      const created = await credentials.provision({
        credentialId: `credential-${index}`, eventId: randomUUID(), normalizedLogin: person.login,
        passwordHash: await hashStaffPassword(syntheticPasswords[index]),
        target: { userId: person.id, expectedIssuer: issuer, expectedSubject: person.subject, expectedUserVersion: 1 },
        actor: { userId: 'synthetic-operator', expectedIssuer: issuer, expectedSubject: 'synthetic-operator-subject', expectedUserVersion: 1 },
      });
      expect(created?.userVersion === 2 && created.credentialVersion === 1, 'actual D1 credential lifecycle published').toBe(true);
    }
  }, 60_000);

  afterAll(async () => {
    try { await runtime?.dispose(); }
    finally {
      trustedAgent?.destroy();
      if (fixtureDirectory) {
        const target = await realpath(fixtureDirectory);
        if (dirname(target) !== fixtureParent || !basename(target).startsWith(fixturePrefix)
          || target !== resolve(fixtureDirectory)) throw new Error('Refusing unsafe fixture cleanup');
        await rm(target, { recursive: true, force: false });
      }
    }
  }, 30_000);

  it('requires this explicit test CA and the correct TLS hostname', async () => {
    expect(['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(await tlsFailure({ agent: false }))).toBe(true);
    expect(await tlsFailure({ servername: 'wrong-orion-host.invalid' })).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
    const accepted = await request('/sign-in');
    expect(accepted.status).toBe(200);
    privateResponse(accepted);
    expect(accepted.body.includes('<form')).toBe(false);
  }, 30_000);

  it('does not authenticate forged Sites headers or expose main clinical routes', async () => {
    const headers = { 'oai-authenticated-user-id': staff[0].subject, 'x-forwarded-user': staff[0].id };
    const api = await request('/api/staff/session', { headers });
    expect(api.status).toBe(401);
    expect(api.body).toBe('{"error":"AUTHENTICATION_REQUIRED"}');
    expect(api.headers['set-cookie']).toBeUndefined();
    const page = await request('/staff', { headers });
    expect(page.status).toBe(303);
    expect(page.headers.location).toBe('/sign-in');
    expect((await request('/api/patients', { headers })).status).toBe(404);
  });

  it('returns the same neutral failure for wrong and unknown individual credentials without a cookie', async () => {
    const errors: string[] = [];
    for (const login of [staff[0].login, 'synthetic.unknown.account']) {
      const denied = await request('/api/staff/login', post({ login, password: 'Synthetic invalid credential' }));
      expect(denied.status).toBe(401);
      privateResponse(denied);
      expect(denied.headers['set-cookie']).toBeUndefined();
      errors.push(denied.body);
    }
    expect(errors[0] === errors[1], 'unknown and wrong password share the public error').toBe(true);
    expect(errors[0]).toBe('{"error":"INVALID_CREDENTIALS"}');
  }, 30_000);

  it('uses real Worker scrypt, shared SSR/API identity, durable logout, restart, reset and disable isolation', async () => {
    const cookies: string[] = [];
    for (const [index, person] of staff.entries()) {
      const loggedIn = await request('/api/staff/login', post({ login: person.login, password: syntheticPasswords[index] }));
      expect(loggedIn.status, 'actual workerd password verification and D1 session issuance').toBe(204);
      privateResponse(loggedIn);
      cookies.push(sessionCookie(loggedIn));
      await currentIdentity(index, cookies[index]);
    }
    expect(cookies[0] !== cookies[1], 'two same-role people have independent opaque sessions').toBe(true);
    const duplicateCookie = await request('/api/staff/session', { headers: { Cookie: `${cookies[0]}; ${cookies[1]}` } });
    expect(duplicateCookie.status).toBe(401);
    expect(duplicateCookie.headers['set-cookie']).toBeUndefined();
    const csrf = await request('/api/staff/logout', {
      ...post(undefined, cookies[0]), headers: { ...post(undefined, cookies[0]).headers, Origin: 'https://untrusted.invalid' },
    });
    expect(csrf.status).toBe(403);
    expect(csrf.headers['set-cookie']).toBeUndefined();
    await currentIdentity(0, cookies[0]);
    const loggedOut = await request('/api/staff/logout', post(undefined, cookies[0]));
    expect(loggedOut.status).toBe(204);
    expect(loggedOut.headers['set-cookie']?.[0].startsWith('__Host-orion_staff_session=;')).toBe(true);
    expect((await request('/api/staff/session', { headers: { Cookie: cookies[0] } })).status).toBe(401);
    expect((await request('/staff', { headers: { Cookie: cookies[0] } })).status).toBe(303);
    await currentIdentity(1, cookies[1]);

    await runtime!.dispose();
    runtime = undefined;
    await startRuntime(); // Same uniquely-owned D1 files; no migrations/reseeding.
    expect((await request('/api/staff/session', { headers: { Cookie: cookies[0] } })).status).toBe(401);
    await currentIdentity(1, cookies[1]);

    // These are trusted synthetic fixture commands, not an administration route
    // or proof that any authenticated staff member can provision/reset/disable.
    const database = await runtime!.getD1Database('DB');
    const credentials = new D1StaffCredentialRepository(database);
    const syntheticResetPassword = `Synthetic-replacement-${randomUUID()}`;
    const actor = {
      userId: 'synthetic-operator', expectedIssuer: issuer,
      expectedSubject: 'synthetic-operator-subject', expectedUserVersion: 1,
    };
    const target = {
      userId: staff[1].id, expectedIssuer: issuer,
      expectedSubject: staff[1].subject, expectedUserVersion: 2,
    };
    const reset = await credentials.reset({
      credentialId: 'credential-1', eventId: randomUUID(), actor, target,
      expectedCredentialVersion: 1, passwordHash: await hashStaffPassword(syntheticResetPassword),
    });
    expect(reset?.userVersion === 3 && reset.credentialVersion === 2, 'reset advances durable credential and user epochs').toBe(true);
    expect((await request('/api/staff/session', { headers: { Cookie: cookies[1] } })).status).toBe(401);
    expect((await request('/staff', { headers: { Cookie: cookies[1] } })).status).toBe(303);
    const oldPassword = await request('/api/staff/login', post({ login: staff[1].login, password: syntheticPasswords[1] }));
    expect(oldPassword.status).toBe(401);
    expect(oldPassword.headers['set-cookie']).toBeUndefined();
    const newLogin = await request('/api/staff/login', post({ login: staff[1].login, password: syntheticResetPassword }));
    expect(newLogin.status).toBe(204);
    const replacementCookie = sessionCookie(newLogin);
    expect(replacementCookie !== cookies[1], 'reset cannot reuse an old opaque token').toBe(true);
    await currentIdentity(1, replacementCookie);
    const disabled = await credentials.disable({
      credentialId: 'credential-1', eventId: randomUUID(), actor,
      target: { ...target, expectedUserVersion: 3 }, expectedCredentialVersion: 2,
    });
    expect(disabled?.userVersion === 4 && disabled.status === 'disabled', 'disable advances the durable user epoch').toBe(true);
    expect((await request('/api/staff/session', { headers: { Cookie: replacementCookie } })).status).toBe(401);
    expect((await request('/staff', { headers: { Cookie: replacementCookie } })).status).toBe(303);
    const disabledLogin = await request('/api/staff/login', post({ login: staff[1].login, password: syntheticResetPassword }));
    expect(disabledLogin.status).toBe(401);
    expect(disabledLogin.headers['set-cookie']).toBeUndefined();
    expect((await request('/api/staff/session', { headers: { Cookie: cookies[0] } })).status).toBe(401);
    expect((await request('/api/staff/session', { headers: { Cookie: cookies[1] } })).status).toBe(401);
  }, 60_000);
});
