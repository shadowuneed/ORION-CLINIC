import {randomUUID} from 'node:crypto';
import {readFileSync,realpathSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Client} from 'pg';
import {beforeAll,afterAll,beforeEach,afterEach,describe,it,expect} from 'vitest';
import {directorySnapshotSchema,directoryModeSchema} from '../../lib/clinical/directory-contracts';

describe.runIf(process.env.ORION_CLINICAL_PG_TEST==='1')('directory draft actual PostgreSQL rollback',()=>{
  let client:Client;let clinic:string;let other:string;let issuer:string;let initialSource:string;
  beforeAll(async()=>{
    if(!process.env.LOCALAPPDATA)throw new Error('Private runtime required');const base=join(process.env.LOCALAPPDATA,'ORION-Clinic-CRM');
    const marker=JSON.parse(readFileSync(join(base,'cluster-owner.json'),'utf8'));
    if(marker.kind!=='orion-crm-local-v1'||marker.port!==55432||resolve(marker.data).toLowerCase()!==resolve(base,'data').toLowerCase())throw new Error('Owned local cluster required');
    const admin=JSON.parse(readFileSync(join(base,'admin.json'),'utf8'));if(admin.host!=='127.0.0.1'||admin.port!==55432||admin.user!=='postgres')throw new Error('Wrong explicit database');
    const {password}=admin;client=new Client({host:'127.0.0.1',port:55432,database:'orion_crm_local',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000,statement_timeout:15000});await client.connect();
    expect(realpathSync((await client.query('SHOW data_directory')).rows[0].data_directory).toLowerCase()).toBe(realpathSync(marker.data).toLowerCase());
    await client.query('BEGIN');
    if(!(await client.query("SELECT 1 FROM pg_namespace WHERE nspname='orion_directory'")).rowCount){
      const top=new URL('./0002_identity_directory.sql',import.meta.url);
      await client.query(readFileSync(existsSync(top)?top:new URL('./drafts/0002_identity_directory.sql',import.meta.url),'utf8').replace(/^([\s\S]*?)BEGIN;\s*/,'$1').replace(/COMMIT;\s*$/,''));
    }
    initialSource=(await client.query('SELECT source FROM orion_directory.runtime WHERE id=1')).rows[0].source;
  },30000);
  afterAll(async()=>{if(client){await client.query('ROLLBACK');await client.end();}});
  beforeEach(async()=>{
    await client.query('SAVEPOINT directory_case');clinic=`directory-${randomUUID()}`;other=`other-${randomUUID()}`;issuer=clinic;
    await client.query("INSERT INTO orion_crm.clinics(id,name) VALUES($1,'Directory rollback clinic'),($2,'Other clinic')",[clinic,other]);
    await client.query("INSERT INTO orion_crm.rooms VALUES($1,'room','Room','consultation',0,0,4,4)",[clinic]);
    for(const who of ['owner','doctor','staff']){
      await client.query("INSERT INTO orion_directory.accounts(id,issuer,subject,display_name,status,source) VALUES($1,$2,$3,$3,'active','postgres')",[`${clinic}-${who}`,issuer,who]);
      await client.query("INSERT INTO orion_directory.memberships(clinic_id,id,user_id,status) VALUES($1,$2,$3,'active')",[clinic,`membership-${who}`,`${clinic}-${who}`]);
      await client.query("INSERT INTO orion_directory.assignments(clinic_id,id,membership_id,roles,status,effective_from) VALUES($1,$2,$3,$4,'active',clock_timestamp()-interval '1 day')",[clinic,`assignment-${who}`,`membership-${who}`,who==='owner'?['doctor','administrator']:who==='doctor'?['doctor']:['registrar']]);
      if(who!=='staff'){
        await client.query("INSERT INTO orion_crm.staff VALUES($1,$2,$2,'doctor','room')",[clinic,who]);
        await client.query("INSERT INTO orion_crm.actor_grants(id,clinic_id,issuer,subject,label,can_read,can_manage) VALUES($1,$2,$3,$4,$4,true,true)",[`grant-${who}`,clinic,issuer,who]);
        await client.query("INSERT INTO orion_clinical.practitioners VALUES($1,$2,$3,$4,$5,$5,'general',true,clock_timestamp(),'fixture')",[clinic,`practitioner-${who}`,who,issuer,who]);
      }
    }
  });
  afterEach(async()=>{await client.query('ROLLBACK TO SAVEPOINT directory_case');await client.query('RELEASE SAVEPOINT directory_case');});
  async function query(sql:string,params:unknown[]=[]){await client.query('SAVEPOINT directory_probe');try{await client.query('SET LOCAL ROLE orion_crm_app');const result=await client.query(sql,params);await client.query('RESET ROLE');await client.query('RELEASE SAVEPOINT directory_probe');return result.rows[0]?.result;}catch(error){await client.query('ROLLBACK TO SAVEPOINT directory_probe');await client.query('RESET ROLE');await client.query('RELEASE SAVEPOINT directory_probe');throw error;}}
  async function activate(){await client.query("UPDATE orion_directory.runtime SET source='postgres',import_complete=true,activated_at=clock_timestamp(),revision=revision+1 WHERE id=1");}
  const command=(who:string,body:Record<string,unknown>)=>query('SELECT public.orion_directory_command_v1($1,$2,$3::jsonb) result',[issuer,who,JSON.stringify({clinicId:clinic,idempotencyKey:randomUUID(),...body})]);
  const snapshot=(who='owner',target=clinic)=>query('SELECT public.orion_directory_snapshot_v1($1,$2,$3) result',[issuer,who,target]).then(v=>directorySnapshotSchema.parse(v));
  const replacement={type:'assignment.replace',assignmentId:'assignment-doctor',expectedVersion:1,roles:['doctor'],allowPermissions:[],denyPermissions:[],staffId:'doctor',specialty:'endocrinology',reason:'Reviewed specialty assignment'};
  it('keeps import inert before explicit cutover and supplies minimal read-only auth principals afterward',async()=>{
    expect(directoryModeSchema.parse(await query('SELECT public.orion_directory_mode_v1() result')).source).toBe(initialSource);
    if(initialSource==='legacy_d1')await expect(query('SELECT public.orion_directory_principals_v1() result')).rejects.toMatchObject({message:'DIRECTORY_NOT_ACTIVE'});
    await activate();const principals=await query('SELECT public.orion_directory_principals_v1() result');
    expect(principals.filter((p:{issuer:string})=>p.issuer===issuer)).toHaveLength(3);expect(Object.keys(principals[0]).sort()).toEqual(['id','issuer','name','subject']);
    await expect(query('SELECT * FROM orion_directory.accounts')).rejects.toMatchObject({code:'42501'});
    await client.query("UPDATE orion_directory.memberships SET interactive=false WHERE clinic_id=$1 AND id='membership-staff'",[clinic]);
    expect((await query('SELECT public.orion_directory_principals_v1() result')).some((p:{id:string})=>p.id===`${clinic}-staff`)).toBe(false);
  });
  it('requires same-clinic administrative authority, not a doctor role or forged clinic',async()=>{
    await activate();expect((await snapshot()).accounts).toHaveLength(3);
    await expect(snapshot('doctor')).rejects.toMatchObject({message:'DIRECTORY_ACCESS_DENIED'});
    await expect(snapshot('owner',other)).rejects.toMatchObject({message:'DIRECTORY_ACCESS_DENIED'});
    expect((await snapshot()).assignments.find(a=>a.id==='assignment-doctor')).toMatchObject({staffId:'doctor',specialty:'general'});
  });
  it('protects the last administrator and preserves authority after rejected self-revocation',async()=>{
    await activate();await expect(command('owner',{type:'assignment.revoke',assignmentId:'assignment-owner',expectedVersion:1,reason:'Revoke'})).rejects.toMatchObject({message:'DIRECTORY_LAST_ADMIN_REQUIRED'});
    await expect(command('owner',{type:'membership.disable',membershipId:'membership-owner',expectedVersion:1,reason:'Disable'})).rejects.toMatchObject({message:'DIRECTORY_LAST_ADMIN_REQUIRED'});
    expect((await snapshot()).assignments.find(a=>a.id==='assignment-owner')?.status).toBe('active');
  });
  it('uses explicit mapping, immutable audit, CAS, deny-overrides and content-bound replay',async()=>{
    await activate();const body={...replacement,idempotencyKey:randomUUID()};const first=await command('owner',body);expect((await command('owner',body)).replayed).toBe(true);
    await expect(command('owner',{...body,specialty:'other'})).rejects.toMatchObject({message:'DIRECTORY_IDEMPOTENCY_CONFLICT'});
    await expect(command('owner',replacement)).rejects.toMatchObject({message:'DIRECTORY_VERSION_CONFLICT'});
    for(const expectedVersion of [null,'2',0,1.5])await expect(command('owner',{...replacement,expectedVersion})).rejects.toMatchObject({message:'DIRECTORY_INVALID_COMMAND'});
    expect(first.version).toBe(2);
    await command('owner',{...replacement,expectedVersion:2,denyPermissions:['encounter.manage']});
    await expect(query('SELECT public.orion_clinical_snapshot_v1($1,$2,NULL) result',[issuer,'doctor'])).rejects.toMatchObject({message:'CLINICAL_ACCESS_DENIED'});
    // Even a stale compatibility grant cannot restore clinical authority.
    await client.query("UPDATE orion_crm.actor_grants SET active=true,can_read=true,can_manage=true WHERE clinic_id=$1 AND subject='doctor'",[clinic]);
    await client.query("UPDATE orion_clinical.practitioners SET active=true WHERE clinic_id=$1 AND subject='doctor'",[clinic]);
    await expect(query('SELECT public.orion_clinical_snapshot_v1($1,$2,NULL) result',[issuer,'doctor'])).rejects.toMatchObject({message:'CLINICAL_ACCESS_DENIED'});
    await client.query('SAVEPOINT audit_mutation');await expect(client.query('DELETE FROM orion_directory.audit_events WHERE clinic_id=$1',[clinic])).rejects.toMatchObject({message:'CLINICAL_IMMUTABLE_HISTORY'});await client.query('ROLLBACK TO SAVEPOINT audit_mutation');
  });
  it('creates employees without credentials and does not grant clinical access to an administrator alone',async()=>{
    await activate();const created=await command('owner',{type:'account.create',name:'New administrator'});
    await command('owner',{type:'assignment.create',membershipId:created.resourceId,roles:['administrator'],allowPermissions:[],denyPermissions:[],staffId:null,specialty:null,reason:'Scoped administrator'});
    const person=(await client.query('SELECT issuer,subject FROM orion_directory.accounts WHERE id=$1',[created.userId])).rows[0];
    await expect(query('SELECT public.orion_clinical_snapshot_v1($1,$2,NULL) result',[person.issuer,person.subject])).rejects.toMatchObject({message:'CLINICAL_ACCESS_DENIED'});
    expect((await query('SELECT public.orion_directory_snapshot_v1($1,$2,$3) result',[person.issuer,person.subject,clinic])).accounts).toHaveLength(4);
  });
  it('removes a disabled membership immediately from login principals and clinical access',async()=>{
    await activate();await command('owner',{type:'membership.disable',membershipId:'membership-doctor',expectedVersion:1,reason:'Employment ended'});
    expect((await query('SELECT public.orion_directory_principals_v1() result')).some((p:{id:string})=>p.id===`${clinic}-doctor`)).toBe(false);
    await expect(query('SELECT public.orion_clinical_snapshot_v1($1,$2,NULL) result',[issuer,'doctor'])).rejects.toMatchObject({message:'CLINICAL_ACCESS_DENIED'});
  });
  it('preserves another clinic employee login without inventing an assignment or borrowing the primary administrator',async()=>{
    const userId=`${other}-employee`;
    await client.query("INSERT INTO orion_directory.accounts(id,issuer,subject,display_name,status,source,legacy_user_id,source_hash) VALUES($1,$2,'other-employee','Other employee','active','legacy_d1',$1,repeat('a',64))",[userId,issuer]);
    await client.query("INSERT INTO orion_directory.memberships(clinic_id,id,user_id,status) VALUES($1,'other-member',$2,'active')",[other,userId]);
    await activate();
    expect((await query('SELECT public.orion_directory_principals_v1() result')).some((p:{id:string})=>p.id===userId)).toBe(true);
    await expect(query('SELECT public.orion_clinical_snapshot_v1($1,$2,NULL) result',[issuer,'other-employee'])).rejects.toMatchObject({message:'CLINICAL_ACCESS_DENIED'});
    await expect(snapshot('owner',other)).rejects.toMatchObject({message:'DIRECTORY_ACCESS_DENIED'});
    expect((await client.query('SELECT count(*)::int n FROM orion_directory.assignments WHERE clinic_id=$1',[other])).rows[0].n).toBe(0);
  });
});
