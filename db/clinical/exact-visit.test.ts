import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { clinicalSnapshotSchema, clinicalCommandResultSchema, type ClinicalInternalCommand } from '../../lib/clinical/contracts';

// Explicit local-only rollback test. No persistent seed, accounts or grant changes.
describe.runIf(process.env.ORION_CLINICAL_PG_TEST==='1')('exact visit and recipient forward migration PostgreSQL', () => {
  let client: Client; let clinic: string; let patient: string; let otherPatient: string; let visit: string; let originalOids: number[];
  const issuer='orion:clinical-rollback-test';
  beforeAll(async()=>{
    if(!process.env.LOCALAPPDATA) throw new Error('Local runtime required');
    const base=join(process.env.LOCALAPPDATA,'ORION-Clinic-CRM');
    const marker=JSON.parse(readFileSync(join(base,'cluster-owner.json'),'utf8'));
    if(marker.kind!=='orion-crm-local-v1'||marker.port!==55432||resolve(marker.data).toLowerCase()!==resolve(base,'data').toLowerCase()) throw new Error('Owned cluster required');
    const admin=JSON.parse(readFileSync(join(base,'admin.json'),'utf8'));
    if(admin.host!=='127.0.0.1'||admin.port!==55432||admin.user!=='postgres'||typeof admin.password!=='string') throw new Error('Explicit local admin required');
    const { password }=admin;
    client=new Client({host:'127.0.0.1',port:55432,user:'postgres',password,database:'orion_crm_local',ssl:false,connectionTimeoutMillis:3000,statement_timeout:15000});
    await client.connect();
    expect(realpathSync((await client.query('SHOW data_directory')).rows[0].data_directory).toLowerCase()).toBe(realpathSync(marker.data).toLowerCase());
    await client.query('BEGIN');
    if(!(await client.query("SELECT 1 FROM pg_namespace WHERE nspname='orion_clinical'")).rowCount){
      const sql=readFileSync(new URL('./0001_unified_care.sql',import.meta.url),'utf8').replace(/^([\s\S]*?)BEGIN;\s*/,'$1').replace(/COMMIT;\s*$/,'');
      await client.query(sql);
    }
    originalOids=(await client.query("SELECT oid FROM pg_proc WHERE proname IN ('orion_clinical_command_v1','orion_clinical_snapshot_v1') ORDER BY proname")).rows.map(row=>row.oid);
    const hasLedger=Boolean((await client.query("SELECT to_regclass('public.orion_clinical_migrations') present")).rows[0].present);
    const applied=new Set<string>(hasLedger?(await client.query('SELECT name FROM public.orion_clinical_migrations')).rows.map(row=>row.name):[]);
    const hasExactVisit=Boolean((await client.query("SELECT to_regprocedure('orion_clinical.is_current_recipient(text,text)') present")).rows[0].present);
    for(const name of ['0002_identity_directory.sql','0003_crm_encounter_consistency.sql','0004_exact_visit_and_recipient.sql']){
      if(applied.has(name))continue;
      if(name.startsWith('0002')&&(await client.query("SELECT 1 FROM pg_namespace WHERE nspname='orion_directory'")).rowCount)continue;
      // Never overwrite a newer wrapper with its predecessor, even inside this
      // rollback-only test transaction. Test the actual deployed guards.
      if(hasExactVisit&&(name.startsWith('0003')||name.startsWith('0004')))continue;
      const top=new URL('./'+name,import.meta.url);const path=existsSync(top)?top:new URL('./drafts/'+name,import.meta.url);
      await client.query(readFileSync(path,'utf8').replace(/^([\s\S]*?)BEGIN;\s*/,'$1').replace(/COMMIT;\s*$/,''));
    }
  },30000);
  afterAll(async()=>{if(client){await client.query('ROLLBACK');await client.end();}});
  beforeEach(async()=>{
    await client.query('SAVEPOINT clinical_case');
    clinic=`clinical-test-${randomUUID()}`;patient='patient-a';otherPatient='patient-c';
    await client.query("INSERT INTO orion_crm.clinics(id,name) VALUES($1,'Rollback clinical clinic')",[clinic]);
    await client.query("INSERT INTO orion_crm.clinic_calendar VALUES($1,'Asia/Qyzylorda',ARRAY[1,2,3,4,5],540,1080,'synthetic_policy')",[clinic]);
    await client.query("INSERT INTO orion_crm.rooms VALUES($1,'room-a','Room A','consultation',0,0,4,4),($1,'room-b','Room B','consultation',10,0,4,4),($1,'room-c','Room C','consultation',20,0,4,4)",[clinic]);
    for(const doctor of ['a','b','c']){
      await client.query("INSERT INTO orion_crm.actor_grants(id,clinic_id,issuer,subject,label,can_read,can_manage) VALUES($1,$2,$3,$4,$4,true,true)",[`grant-${doctor}`,clinic,issuer,`${clinic}-${doctor}`]);
      await client.query("INSERT INTO orion_crm.staff VALUES($1,$2,$2,'doctor',$3)",[clinic,`doctor-${doctor}`,`room-${doctor}`]);
      await client.query("INSERT INTO orion_clinical.practitioners VALUES($1,$2,$3,$4,$5,'Verified clinician','endocrinology',true,clock_timestamp(),'rollback fixture')",[clinic,`practitioner-${doctor}`,`doctor-${doctor}`,issuer,`${clinic}-${doctor}`]);
      const userId=`${clinic}-user-${doctor}`;
      await client.query("INSERT INTO orion_directory.accounts(id,issuer,subject,display_name,status,source) VALUES($1,$2,$3,'Rollback clinician','active','postgres')",[userId,issuer,`${clinic}-${doctor}`]);
      await client.query("INSERT INTO orion_directory.memberships(clinic_id,id,user_id,status) VALUES($1,$2,$3,'active')",[clinic,`member-${doctor}`,userId]);
      await client.query("INSERT INTO orion_directory.assignments(clinic_id,id,membership_id,roles,status,effective_from) VALUES($1,$2,$3,ARRAY['doctor'],'active',clock_timestamp()-interval '2 days')",[clinic,`assignment-${doctor}`,`member-${doctor}`]);
    }
    await client.query("INSERT INTO orion_crm.services VALUES($1,'service','Consultation',30,'consultation')",[clinic]);
    await client.query("INSERT INTO orion_crm.patients VALUES($1,$2,'Patient A','CRM-9998','female'),($1,$3,'Patient C','CRM-9999','male')",[clinic,patient,otherPatient]);
    const scheduledAt=(await client.query(`WITH d AS (SELECT date_trunc('day',clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')+interval '30 days' t)
      SELECT orion_crm.iso((t+((8-extract(isodow FROM t)::int)%7)*interval '1 day'+interval '10 hours') AT TIME ZONE 'Asia/Qyzylorda') t FROM d`)).rows[0].t;
    for(const doctor of ['a','c']){
      const result=(await client.query('SELECT public.orion_crm_command_v1($1,$2,$3::jsonb) result',[issuer,`${clinic}-${doctor}`,JSON.stringify({type:'visit.create',patientId:doctor==='a'?patient:otherPatient,staffId:`doctor-${doctor}`,roomId:`room-${doctor}`,serviceId:'service',scheduledAt,testDataAcknowledged:true,idempotencyKey:randomUUID()})])).rows[0].result;
      if(doctor==='a') visit=result.resourceId;
    }
  });
  afterEach(async()=>{await client.query('ROLLBACK TO SAVEPOINT clinical_case');await client.query('RELEASE SAVEPOINT clinical_case');});
  async function rpc(name:string,doctor:string,command:unknown=null){
    await client.query('SAVEPOINT clinical_probe');
    try{
      await client.query('SET LOCAL ROLE orion_crm_app');
      const result=await client.query(`SELECT public.${name}($1,$2,$3) result`,[issuer,`${clinic}-${doctor}`,command===null?null:JSON.stringify(command)]);
      await client.query('RESET ROLE');await client.query('RELEASE SAVEPOINT clinical_probe');return result.rows[0].result;
    }catch(error){await client.query('ROLLBACK TO SAVEPOINT clinical_probe');await client.query('RESET ROLE');await client.query('RELEASE SAVEPOINT clinical_probe');throw error;}
  }
  const command=(doctor:string,body:Omit<ClinicalInternalCommand,'idempotencyKey'>|Record<string,unknown>)=>rpc('orion_clinical_command_v1',doctor,{idempotencyKey:randomUUID(),...body}).then(value=>clinicalCommandResultSchema.parse(value));
  const snapshot=async(doctor:string)=>clinicalSnapshotSchema.parse(await rpc('orion_clinical_snapshot_v1',doctor));
  async function started(){return command('a',{type:'encounter.start',patientId:patient});}
  async function consent(encounterId:string,expectedVersion:number,granted=true){return command('a',{type:'consent.record',encounterId,expectedVersion,care:true,transcriptStorage:granted,localAudioProcessing:granted,externalAiProcessing:false,patientConfirmed:true});}
  const content={complaints:'Reviewed symptom',history:'Patient reported history',examination:'Clinician entered findings',assessment:'Clinician assessment',plan:'Follow-up plan'};
  async function published(){
    const opened=await started();const c=await consent(opened.resourceId,opened.version);
    const draft=await command('a',{type:'note.save',encounterId:opened.resourceId,expectedVersion:c.version,content,source:'ai_assisted'});
    const result=await command('a',{type:'note.publish',encounterId:opened.resourceId,expectedVersion:draft.version,noteId:draft.resourceId,reviewAcknowledged:true});
    return {...result,encounterId:opened.resourceId};
  }
  async function laterVisit(doctor='a',patientId=patient){
    const scheduledAt=(await client.query("SELECT orion_crm.iso(scheduled_at+interval '30 minutes') t FROM orion_crm.visits WHERE clinic_id=$1 AND id=$2",[clinic,visit])).rows[0].t;
    return(await client.query('SELECT public.orion_crm_command_v1($1,$2,$3::jsonb) result',[issuer,`${clinic}-${doctor}`,JSON.stringify({type:'visit.create',patientId,staffId:`doctor-${doctor}`,roomId:`room-${doctor}`,serviceId:'service',scheduledAt,testDataAcknowledged:true,idempotencyKey:randomUUID()})])).rows[0].result.resourceId as string;
  }
  it('preserves public function OIDs, restricted grants and exact later calendar choice',async()=>{
    expect((await client.query("SELECT oid FROM pg_proc WHERE proname IN ('orion_clinical_command_v1','orion_clinical_snapshot_v1') ORDER BY proname")).rows.map(row=>row.oid)).toEqual(originalOids);
    const later=await laterVisit();
    const body={type:'encounter.start',patientId:patient,visitId:later,idempotencyKey:randomUUID()};
    const result=await command('a',body);
    expect((await snapshot('a')).encounters.find(row=>row.id===result.resourceId)?.visitId).toBe(later);
    expect((await client.query('SELECT status FROM orion_crm.visits WHERE clinic_id=$1 AND id=$2',[clinic,visit])).rows[0].status).toBe('scheduled');
    expect((await command('a',body)).replayed).toBe(true);
    await expect(command('a',{...body,visitId:visit})).rejects.toMatchObject({message:'CLINICAL_IDEMPOTENCY_CONFLICT'});
    await expect(rpc('orion_crm_command_v1','a',{})).rejects.toMatchObject({code:'42501'});
  });
  it('rejects wrong patients, unknown visits and another doctor before creating any encounter',async()=>{
    const foreign=await laterVisit('b');
    for(const visitId of [foreign,'missing-visit']){
      await expect(command('a',{type:'encounter.start',patientId:patient,visitId})).rejects.toMatchObject({message:'CLINICAL_RESOURCE_NOT_FOUND'});
    }
    await expect(command('a',{type:'encounter.start',patientId:otherPatient,visitId:visit})).rejects.toMatchObject({message:'CLINICAL_RESOURCE_NOT_FOUND'});
    for(const visitId of [null,'',1]) await expect(command('a',{type:'encounter.start',patientId:patient,visitId})).rejects.toMatchObject({message:'CLINICAL_INVALID_COMMAND'});
    expect((await client.query('SELECT count(*)::int n FROM orion_clinical.encounters WHERE clinic_id=$1',[clinic])).rows[0].n).toBe(0);
  });
  it('never silently switches an active encounter to a different selected booking',async()=>{
    const later=await laterVisit();const first=await started();
    await expect(command('a',{type:'encounter.start',patientId:patient,visitId:later})).rejects.toMatchObject({code:'PT409',message:'CLINICAL_INVALID_TRANSITION'});
    expect((await started()).resourceId).toBe(first.resourceId);
    expect((await command('a',{type:'encounter.start',patientId:patient,visitId:visit})).resourceId).toBe(first.resourceId);
    expect((await snapshot('a')).encounters[0].visitId).toBe(visit);
  });
  it('can attach an exact booking to an existing card-started encounter without a fabricated visit',async()=>{
    const created=await command('a',{type:'patient.register',name:'New manual patient',birthDate:null,sex:'unknown'});
    const opened=await command('a',{type:'encounter.start',patientId:created.resourceId});
    expect((await snapshot('a')).encounters.find(row=>row.id===opened.resourceId)?.visitId).toBeNull();
    const later=await laterVisit('a',created.resourceId);
    expect((await command('a',{type:'encounter.start',patientId:created.resourceId,visitId:later})).resourceId).toBe(opened.resourceId);
    expect((await snapshot('a')).encounters.find(row=>row.id===opened.resourceId)?.visitId).toBe(later);
  });
  it('filters expired or denied directory recipients and guards direct referral commands despite stale projection',async()=>{
    const p=await published();
    await client.query("UPDATE orion_directory.runtime SET source='postgres',import_complete=true,activated_at=clock_timestamp(),revision=revision+1 WHERE id=1");
    expect((await snapshot('a')).practitioners.map(row=>row.id)).toContain('practitioner-b');
    await client.query("UPDATE orion_directory.assignments SET effective_until=clock_timestamp()-interval '1 day' WHERE clinic_id=$1 AND id='assignment-b'",[clinic]);
    await client.query("UPDATE orion_directory.assignments SET deny_permissions=ARRAY['encounter.manage'] WHERE clinic_id=$1 AND id='assignment-c'",[clinic]);
    expect((await client.query('SELECT active FROM orion_clinical.practitioners WHERE clinic_id=$1 AND id=$2',[clinic,'practitioner-b'])).rows[0].active).toBe(true);
    expect((await snapshot('a')).practitioners.map(row=>row.id)).toEqual(['practitioner-a']);
    for(const recipientPractitionerId of ['practitioner-b','practitioner-c']) await expect(command('a',{type:'referral.create',encounterId:p.encounterId,expectedVersion:p.version,recipientPractitionerId,reason:'Consultation requested',priority:'routine',reviewAcknowledged:true})).rejects.toMatchObject({message:'CLINICAL_RESOURCE_NOT_FOUND'});
    expect((await client.query('SELECT count(*)::int n FROM orion_clinical.referrals WHERE clinic_id=$1',[clinic])).rows[0].n).toBe(0);
    await client.query("UPDATE orion_directory.assignments SET effective_until=NULL WHERE clinic_id=$1 AND id='assignment-b'",[clinic]);
    expect((await command('a',{type:'referral.create',encounterId:p.encounterId,expectedVersion:p.version,recipientPractitionerId:'practitioner-b',reason:'Consultation requested',priority:'routine',reviewAcknowledged:true})).resourceId).toBeTruthy();
  });
  it('honors explicit operation denies without merging a separate registrar role into doctor authority',async()=>{
    await client.query("UPDATE orion_directory.runtime SET source='postgres',import_complete=true,activated_at=clock_timestamp(),revision=revision+1 WHERE id=1");
    await client.query("UPDATE orion_directory.assignments SET deny_permissions=ARRAY['patient.profile.write','scheduling.manage','care.manage'] WHERE clinic_id=$1 AND id='assignment-a'",[clinic]);
    await client.query("INSERT INTO orion_directory.assignments(clinic_id,id,membership_id,roles,status,effective_from) VALUES($1,'registrar-a','member-a',ARRAY['registrar'],'active',clock_timestamp()-interval '1 day')",[clinic]);
    await expect(command('a',{type:'patient.register',name:'Denied registration',birthDate:null,sex:'unknown'})).rejects.toMatchObject({message:'CLINICAL_ACCESS_DENIED'});
    await expect(started()).rejects.toMatchObject({message:'CLINICAL_ACCESS_DENIED'});
    await expect(rpc('orion_clinical_crm_command_v1','a',{type:'visit.transition',visitId:visit,action:'arrive',expectedVersion:1,testDataAcknowledged:true,idempotencyKey:randomUUID()})).rejects.toMatchObject({message:'CRM_ACCESS_DENIED'});
    await expect(rpc('orion_clinical_crm_command_v1','a',{type:'task.create',visitId:visit,ownerId:'doctor-a',testDataAcknowledged:true,idempotencyKey:randomUUID()})).rejects.toMatchObject({message:'CRM_ACCESS_DENIED'});
    expect((await client.query('SELECT status FROM orion_crm.visits WHERE clinic_id=$1 AND id=$2',[clinic,visit])).rows[0].status).toBe('scheduled');
    expect((await client.query('SELECT count(*)::int n FROM orion_clinical.encounters WHERE clinic_id=$1',[clinic])).rows[0].n).toBe(0);
    await client.query("UPDATE orion_directory.assignments SET deny_permissions=ARRAY[]::text[] WHERE clinic_id=$1 AND id='assignment-a'",[clinic]);
    const p=await published();
    await client.query("UPDATE orion_directory.assignments SET deny_permissions=ARRAY['scheduling.manage'] WHERE clinic_id=$1 AND id='assignment-a'",[clinic]);
    await expect(command('a',{type:'encounter.complete',encounterId:p.encounterId,expectedVersion:p.version})).rejects.toMatchObject({message:'CLINICAL_ACCESS_DENIED'});
    expect((await snapshot('a')).encounters[0].status).toBe('in_progress');
  });
});
