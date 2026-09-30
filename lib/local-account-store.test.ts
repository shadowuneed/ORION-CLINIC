import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { bytesToHex, derivePassword, localAccountAuth } from '../scripts/local-account-auth';
import { openLocalAccountStore, readLocalStaff } from '../scripts/local-account-store';

const cleanups: (()=>void|Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'orion-local-accounts-'));
  cleanups.push(()=>{if(dirname(dir)!==tmpdir() || !basename(dir).startsWith('orion-local-accounts-'))throw new Error('Unsafe fixture cleanup');rmSync(dir,{recursive:true});});
  const path=join(dir,'clinical.sqlite');const db=new DatabaseSync(path);
  db.exec(`create table users(id text primary key,external_issuer text,external_subject text,display_name text,status text);
    create table memberships(user_id text,status text,role text);
    insert into users values('u-a','openai:sites','doctor-a','Doctor A','active'),('u-b','orion:synthetic','doctor-b','Doctor B','active');
    insert into memberships values('u-a','active','doctor'),('u-b','active','doctor');`);
  cleanups.push(()=>db.close());
  return {dir,path,db};
}
async function provision(store:ReturnType<typeof openLocalAccountStore>,path:string) {
  const passwords=new Map<string,string>();
  for(const person of readLocalStaff(path)) {
    const generatedPassword=bytesToHex(randomBytes(18)),salt=bytesToHex(randomBytes(16));
    store.provision(person,person.id,salt,bytesToHex(await derivePassword(generatedPassword,salt)));passwords.set(person.id,generatedPassword);
  }
  return passwords;
}
async function runtime(store:ReturnType<typeof openLocalAccountStore>) {
  const server=createServer((req,res)=>void handler(req,res,()=>{res.statusCode=req.headers['oai-authenticated-user-id']?200:401;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({subject:req.headers['oai-authenticated-user-id'],issuer:req.headers['x-orion-local-issuer']}));}));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  cleanups.push(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const address=server.address();if(!address || typeof address==='string')throw new Error('No port');
  const handler=localAccountAuth(address.port,async()=>store.loadAccounts(),Date.now,store);
  const origin=`http://127.0.0.1:${address.port}`;
  const login=async(name:string,password:string,cookie?:string)=>fetch(`${origin}/login`,{method:'POST',redirect:'manual',headers:{origin,'content-type':'application/x-www-form-urlencoded',...(cookie?{cookie}:{})},body:new URLSearchParams({login:name,password})});
  return {origin,login};
}
function sessionHeaders(response:Response) {
  const cookies=response.headers.getSetCookie();
  const cookie=cookies.map(value=>value.split(';')[0]).join('; ');
  const generation=cookies.find(value=>value.startsWith('orion_local_generation='))!.split(';')[0].split('=')[1];
  return {cookie,'x-orion-local-generation':generation};
}

it('persists two distinct staff accounts and sessions across reopen without changing the staff DB',async()=>{
  const fixtureData=fixture();const auth=join(fixtureData.dir,'accounts.sqlite');
  let store=openLocalAccountStore(auth,fixtureData.path);cleanups.push(()=>store.close());
  const before=fixtureData.db.prepare('select * from users order by id').all();
  const passwords=await provision(store,fixtureData.path);
  const app=await runtime(store);
  const a=await app.login('u-a',passwords.get('u-a')!),b=await app.login('u-b',passwords.get('u-b')!);
  expect([a.status,b.status]).toEqual([303,303]);
  const ah=sessionHeaders(a),bh=sessionHeaders(b);
  expect(await(await fetch(`${app.origin}/api/workspace`,{headers:ah})).json()).toEqual({subject:'doctor-a',issuer:'openai:sites'});
  expect(await(await fetch(`${app.origin}/api/workspace`,{headers:bh})).json()).toEqual({subject:'doctor-b',issuer:'orion:synthetic'});
  store.close();store=openLocalAccountStore(auth,fixtureData.path);
  const reopened=await runtime(store);
  expect((await fetch(`${reopened.origin}/api/workspace`,{headers:bh})).status).toBe(200);
  expect(fixtureData.db.prepare('select * from users order by id').all()).toEqual(before);
});

it('fences old-tab JSON reads and writes after a login switch, strips forged identities, and disables a staff session immediately',async()=>{
  const data=fixture();const store=openLocalAccountStore(join(data.dir,'accounts.sqlite'),data.path);cleanups.push(()=>store.close());
  const passwords=await provision(store,data.path);const app=await runtime(store);
  const a=sessionHeaders(await app.login('u-a',passwords.get('u-a')!));
  const b=sessionHeaders(await app.login('u-b',passwords.get('u-b')!,a.cookie));
  for(const method of ['GET','POST']) {
    expect((await fetch(`${app.origin}/api/workspace`,{method,headers:{cookie:b.cookie,'x-orion-local-generation':a['x-orion-local-generation']}})).status).toBe(409);
    expect((await fetch(`${app.origin}/api/workspace`,{method,headers:{cookie:b.cookie}})).status).toBe(409);
  }
  expect((await fetch(`${app.origin}/api/workspace`,{headers:a})).status).toBe(401);
  expect(await(await fetch(`${app.origin}/api/workspace`,{headers:{...b,'oai-authenticated-user-id':'doctor-a','x-orion-local-issuer':'openai:sites'}})).json()).toEqual({subject:'doctor-b',issuer:'orion:synthetic'});
  data.db.prepare("update users set status='disabled' where id='u-b'").run();
  expect((await fetch(`${app.origin}/api/workspace`,{headers:b})).status).toBe(401);
});

it('keeps the rolling attempt limit across reopen and successful logins',()=>{
  const data=fixture(),auth=join(data.dir,'accounts.sqlite');let store=openLocalAccountStore(auth,data.path);cleanups.push(()=>store.close());
  for(let i=0;i<5;i++){expect(store.reserveAttempt(1000)).toBe(true);store.finishAttempt(true);}
  store.close();store=openLocalAccountStore(auth,data.path);
  for(let i=0;i<5;i++)expect(store.reserveAttempt(1000)).toBe(true);
  expect(store.reserveAttempt(1000)).toBe(false);expect(store.reserveAttempt(301001)).toBe(true);
});

it('changes a personal password with current-password verification and revokes all sessions of that person only',async()=>{
  const data=fixture();const store=openLocalAccountStore(join(data.dir,'accounts.sqlite'),data.path);cleanups.push(()=>store.close());
  const passwords=await provision(store,data.path);const app=await runtime(store);
  const a=sessionHeaders(await app.login('u-a',passwords.get('u-a')!));
  const b=sessionHeaders(await app.login('u-b',passwords.get('u-b')!));
  const next=bytesToHex(randomBytes(18));
  const change=(password:string,origin=app.origin)=>fetch(`${app.origin}/account/password`,{method:'POST',redirect:'manual',headers:{origin,cookie:a.cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password,nextPassword:next,confirmPassword:next})});
  expect((await change(passwords.get('u-a')!,'null')).status).toBe(403);
  expect((await change('incorrect')).status).toBe(401);
  expect((await change(passwords.get('u-a')!)).status).toBe(303);
  expect((await fetch(`${app.origin}/api/workspace`,{headers:a})).status).toBe(401);
  expect((await fetch(`${app.origin}/api/workspace`,{headers:b})).status).toBe(200);
  expect((await app.login('u-a',passwords.get('u-a')!)).status).toBe(401);
  expect((await app.login('u-a',next)).status).toBe(303);
});

it('limits concurrent real password derivations after request bodies complete',async()=>{
  const data=fixture();const store=openLocalAccountStore(join(data.dir,'accounts.sqlite'),data.path);cleanups.push(()=>store.close());
  const passwords=await provision(store,data.path);const app=await runtime(store);
  const responses=await Promise.all(Array.from({length:5},()=>app.login('u-a',passwords.get('u-a')!)));
  expect(responses.filter(response=>response.status===303)).toHaveLength(2);
  expect(responses.filter(response=>response.status===429)).toHaveLength(3);
});
