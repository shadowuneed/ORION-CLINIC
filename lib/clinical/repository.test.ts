import type { PoolClient } from 'pg';
import { describe,it,expect,vi } from 'vitest';
import { createClinicalPostgresRepository } from '../../scripts/clinical-postgres-repository';
const config={host:'127.0.0.1',port:55432,database:'orion_crm_local',user:'orion_crm_app',password:'synthetic-unit-not-a-credential'} as const;
const actor={issuer:'unit',subject:'doctor'};
const snapshot={schemaVersion:1,clinicId:'clinic',practitioner:{id:'practitioner',staffId:'doctor',name:'Doctor',specialty:'general'},practitioners:[],patients:[],encounters:[],notes:[],referrals:[],consents:[],transcript:[],generatedAt:'2026-10-07T00:00:00.000Z'};
function fixture(result:unknown=snapshot){
  const query=vi.fn(async(text:string)=>text.startsWith('SELECT')?{rows:[{result}]}:{rows:[]});
  const release=vi.fn();const client={query,release} as unknown as PoolClient;
  const pool={connect:vi.fn(async()=>client),end:vi.fn(async()=>undefined)};
  return {query,release,pool,repository:createClinicalPostgresRepository(config,pool)};
}
describe('clinical server repository',()=>{
  it('uses parameterized actor and patient scope in a committed transaction',async()=>{
    const f=fixture();await expect(f.repository.patient(actor,'patient-1')).resolves.toEqual(snapshot);
    expect(f.query.mock.calls.map(args=>args[0])).toEqual(['BEGIN','SELECT public.orion_clinical_snapshot_v1($1::text,$2::text,$3::text) AS result','COMMIT']);expect(f.release).toHaveBeenCalledOnce();
  });
  it('rejects alternate hosts/users and malformed patient scope before connecting',async()=>{
    expect(()=>createClinicalPostgresRepository({...config,host:'remote'} as never)).toThrow('Invalid dedicated');
    const f=fixture();expect(()=>f.repository.patient(actor,"patient' OR true")).toThrow();expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it('rolls back on a session change before SQL execution',async()=>{
    const f=fixture();let count=0;const changed=Object.assign(new Error('Session changed'),{code:'SESSION_CHANGED'});
    await expect(f.repository.snapshot(actor,async()=>{if(++count===3)throw changed;})).rejects.toBe(changed);
    expect(f.query.mock.calls.map(args=>args[0])).toEqual(['BEGIN','ROLLBACK']);expect(f.release).toHaveBeenCalledOnce();
  });
  it('rejects malformed database DTOs without publishing or committing',async()=>{
    const f=fixture({...snapshot,rawSecret:'must-not-appear'});
    await expect(f.repository.snapshot(actor)).rejects.toMatchObject({code:'CLINICAL_UNAVAILABLE'});
    expect(f.query.mock.calls.map(args=>args[0])).toContain('ROLLBACK');expect(f.query.mock.calls.map(args=>args[0])).not.toContain('COMMIT');
  });
  it('withholds the response after late revocation without pretending a committed write rolled back',async()=>{
    const f=fixture();let count=0;const changed=Object.assign(new Error('Session changed'),{code:'SESSION_CHANGED'});
    await expect(f.repository.snapshot(actor,async()=>{if(++count===5)throw changed;})).rejects.toBe(changed);
    expect(f.query.mock.calls.map(args=>args[0])).toContain('COMMIT');expect(f.query.mock.calls.map(args=>args[0])).not.toContain('ROLLBACK');
  });
});
