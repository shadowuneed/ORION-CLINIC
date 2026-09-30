import { createServer, request } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { personaAuth } from '../scripts/persona-auth';
const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(s => new Promise<void>(r => s.close(() => r())))); });

it('isolates persona identity, rejects CSRF/forgery and invalidates signout', async () => {
  const server = createServer((req, res) => handler(req, res, () => {
    res.statusCode = req.headers['oai-authenticated-user-id'] ? 200 : 401;
    res.end(String(req.headers['oai-authenticated-user-id'] ?? 'anonymous'));
  }));
  servers.push(server);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test listener');
  const handler = personaAuth(address.port);
  const origin = `http://127.0.0.1:${address.port}`;
  expect((await fetch(origin, {headers:{'oai-authenticated-user-id':'forged'}})).status).toBe(401);
  expect((await fetch(`${origin}/__test/select?persona=nurse`, {method:'POST',headers:{origin:'https://external.test'}})).status).toBe(403);
  const forgedHost = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(origin, { headers: { host: 'external.test' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  expect(forgedHost).toBe(403);
  const login = await fetch(`${origin}/__test/select?persona=nurse`, {method:'POST',headers:{origin},redirect:'manual'});
  expect(login.status).toBe(303);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  expect(await (await fetch(origin, {headers:{cookie}})).text()).toBe('persona-nurse');
  expect((await fetch(origin,{headers:{cookie:`${cookie}; ${cookie}`}})).status).toBe(401);
  await fetch(`${origin}/signout-with-chatgpt`,{method:'POST',headers:{origin,cookie},redirect:'manual'});
  expect((await fetch(origin,{headers:{cookie}})).status).toBe(401);
});
