import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { bytesToHex, derivePassword, localAccountAuth, parseLocalAccounts } from '../scripts/local-account-auth';
const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => s.close(() => resolve())))); });

it('authenticates a password, rejects forgery and CSRF, expires and revokes sessions', async () => {
  const passphrase = bytesToHex(randomBytes(24)); const salt = bytesToHex(randomBytes(16));
  let accounts = [{ login: 'doctor', subject: 'local-staff-doctor', issuer: 'openai:sites', name: 'Test doctor', salt, digest: bytesToHex(await derivePassword(passphrase, salt)) }];
  let time = 1000;
  const server = createServer((req, res) => { void handler(req, res, () => { res.statusCode = req.headers['oai-authenticated-user-id'] ? 200 : 401; res.end(String(req.headers['oai-authenticated-user-id'] ?? 'anonymous')); }); });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No port');
  const handler = localAccountAuth(address.port, async () => accounts, () => time);
  const origin = `http://127.0.0.1:${address.port}`;
  expect((await fetch(`${origin}/sign-in`)).headers.get('referrer-policy')).toBe('same-origin');
  const login = (password = passphrase, source = origin) => fetch(`${origin}/login`, { method: 'POST', headers: { origin: source, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ login: 'doctor', password }), redirect: 'manual' });
  expect((await fetch(origin, { headers: { 'oai-authenticated-user-id': 'forged' } })).status).toBe(401);
  expect((await login(passphrase, 'https://external.test')).status).toBe(403);
  expect((await login(passphrase, 'null')).status).toBe(403);
  expect((await login('incorrect')).status).toBe(401);
  const signedIn = await login(); expect(signedIn.status).toBe(303);
  const cookie = signedIn.headers.get('set-cookie')!.split(';')[0];
  expect(signedIn.headers.get('set-cookie')).toContain('HttpOnly');
  expect(await (await fetch(origin, { headers: { cookie } })).text()).toBe('local-staff-doctor');
  expect((await fetch(origin, { headers: { cookie: `${cookie}; ${cookie}` } })).status).toBe(401);
  expect((await fetch(`${origin}/logout`, { method: 'POST', headers: { origin, cookie }, redirect: 'manual' })).status).toBe(303);
  expect((await fetch(origin, { headers: { cookie } })).status).toBe(401);
  const expiring = (await login()).headers.get('set-cookie')!.split(';')[0];
  time += 1800001;
  expect((await fetch(origin, { headers: { cookie: expiring } })).status).toBe(401);
  const revoked = (await login()).headers.get('set-cookie')!.split(';')[0];
  accounts = [];
  expect((await fetch(origin, { headers: { cookie: revoked } })).status).toBe(401);
  expect(await (await fetch(`${origin}/login`)).text()).toContain('configure-local-accounts.mjs');
});

it('rejects malformed or duplicate account registries', () => {
  expect(() => parseLocalAccounts({})).toThrow();
  expect(() => parseLocalAccounts([{ login: 'doctor', subject: 'arbitrary-admin' }])).toThrow();
});
