import { beforeEach,expect,it,vi } from 'vitest';
const {enabled}=vi.hoisted(()=>({enabled:vi.fn(()=>false)}));
vi.mock('../local-account-mode',()=>({localAccountModeEnabled:enabled}));
import {getSiteIdentity,toSiteIdentityPrincipal} from './site-identity';
beforeEach(()=>enabled.mockReturnValue(false));
it('ignores the local issuer header when the local-only build flag is disabled',()=>{
  const identity=getSiteIdentity(new Request('https://orion.test/api/access',{headers:{'oai-authenticated-user-id':'subject-a','x-orion-local-issuer':'forged'}}));
  expect(identity).toEqual({id:'subject-a',email:null});
  expect(toSiteIdentityPrincipal(identity!)).toEqual({issuer:'openai:sites',subject:'subject-a',email:null});
});
it('preserves exact existing issuer and subject only in the explicit local transport',()=>{
  enabled.mockReturnValue(true);
  const headers={'oai-authenticated-user-id':'nurse-a','x-orion-local-issuer':'orion:synthetic','x-orion-local-generation':'a'.repeat(32)};
  const identity=getSiteIdentity(new Request('http://127.0.0.1:3200/api/access',{headers}));
  expect(toSiteIdentityPrincipal(identity!)).toEqual({issuer:'orion:synthetic',subject:'nurse-a',email:null});
  expect(getSiteIdentity(new Request('http://127.0.0.1:3200/api/access',{headers:{'oai-authenticated-user-id':'local_seedy'}}))).toBeNull();
});
