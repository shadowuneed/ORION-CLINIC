import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { clinicalSnapshotSchema, clinicalCommandResultSchema, type ClinicalInternalCommand } from '../../lib/clinical/contracts';

// Explicit local-only rollback test. No persistent seed, accounts or grant changes.
describe.runIf(process.env.ORION_CLINICAL_PG_TEST==='1')('unified clinical PostgreSQL', () => {
  let client: Client; let clinic: string; let patient: string; let otherPatient: string; let visit: string;
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
      if((await client.query("SELECT 1 FROM pg_namespace WHERE nspname='orion_directory'")).rowCount){
        const userId=`${clinic}-user-${doctor}`;
        await client.query("INSERT INTO orion_directory.accounts(id,issuer,subject,display_name,status,source) VALUES($1,$2,$3,'Rollback clinician','active','postgres')",[userId,issuer,`${clinic}-${doctor}`]);
        await client.query("INSERT INTO orion_directory.memberships(clinic_id,id,user_id,status) VALUES($1,$2,$3,'active')",[clinic,`member-${doctor}`,userId]);
        await client.query("INSERT INTO orion_directory.assignments(clinic_id,id,membership_id,roles,status,effective_from) VALUES($1,$2,$3,ARRAY['doctor'],'active',clock_timestamp()-interval '1 day')",[clinic,`assignment-${doctor}`,`member-${doctor}`]);
      }
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
  it('uses the existing patient/visit and one-action start resumes without duplicates',async()=>{
    const one=await started();const two=await started();expect(two.resourceId).toBe(one.resourceId);
    const data=await snapshot('a');expect(data.patients.map(p=>p.id)).toEqual([patient]);expect(data.encounters[0].visitId).toBe(visit);
    expect((await client.query('SELECT status FROM orion_crm.visits WHERE clinic_id=$1 AND id=$2',[clinic,visit])).rows[0].status).toBe('in_service');
    expect((await client.query('SELECT count(*)::int n FROM orion_clinical.encounters WHERE clinic_id=$1',[clinic])).rows[0].n).toBe(1);
    await expect(command('b',{type:'encounter.start',patientId:patient})).rejects.toMatchObject({code:'PT404'});
  });
  it('completes the linked operational visit only after a reviewed publication',async()=>{
    const p=await published();await command('a',{type:'encounter.complete',encounterId:p.encounterId,expectedVersion:p.version});
    expect((await client.query('SELECT status FROM orion_crm.visits WHERE clinic_id=$1 AND id=$2',[clinic,visit])).rows[0].status).toBe('completed');
    expect((await client.query("SELECT count(*)::int n FROM orion_crm.audit_entries WHERE clinic_id=$1 AND visit_id=$2 AND to_status='completed'",[clinic,visit])).rows[0].n).toBe(1);
  });
  it('does not jump the operational queue and rolls back the whole one-click start',async()=>{
    const ahead='patient-ahead';await client.query("INSERT INTO orion_crm.patients VALUES($1,$2,'Earlier arrival','CRM-9997','unknown')",[clinic,ahead]);
    const at=(await client.query("SELECT orion_crm.iso(scheduled_at+interval '30 minutes') t FROM orion_crm.visits WHERE clinic_id=$1 AND id=$2",[clinic,visit])).rows[0].t;
    async function operation(body:unknown){return(await client.query('SELECT public.orion_crm_command_v1($1,$2,$3::jsonb) result',[issuer,`${clinic}-a`,JSON.stringify(body)])).rows[0].result;}
    let prior=await operation({type:'visit.create',patientId:ahead,staffId:'doctor-a',roomId:'room-a',serviceId:'service',scheduledAt:at,testDataAcknowledged:true,idempotencyKey:randomUUID()});
    for(const action of ['arrive','queue']) prior=await operation({type:'visit.transition',visitId:prior.resourceId,expectedVersion:prior.version,action,testDataAcknowledged:true,idempotencyKey:randomUUID()});
    await expect(started()).rejects.toMatchObject({message:'CLINICAL_QUEUE_ORDER_CONFLICT'});
    expect((await client.query('SELECT status FROM orion_crm.visits WHERE clinic_id=$1 AND id=$2',[clinic,visit])).rows[0].status).toBe('scheduled');
    expect((await client.query('SELECT count(*)::int n FROM orion_clinical.encounters WHERE clinic_id=$1',[clinic])).rows[0].n).toBe(0);
  });
  it('registers a real manual profile in the shared registry without inventing a visit',async()=>{
    const body={type:'patient.register',name:'New registered patient',sex:'female',birthDate:'2017-02-04',idempotencyKey:randomUUID()};
    const created=await command('b',body);expect(created.encounterId).toBeNull();expect((await command('b',body)).replayed).toBe(true);
    const profile=(await snapshot('b')).patients.find(p=>p.id===created.resourceId);expect(profile).toMatchObject({name:body.name,birthDate:body.birthDate});
    expect((await client.query('SELECT count(*)::int n FROM orion_crm.visits WHERE clinic_id=$1 AND patient_id=$2',[clinic,created.resourceId])).rows[0].n).toBe(0);
    expect((await snapshot('a')).patients.some(p=>p.id===created.resourceId)).toBe(false);
    const opened=await command('b',{type:'encounter.start',patientId:created.resourceId});expect(opened.encounterId).toBeTruthy();
    await expect(command('b',{...body,idempotencyKey:randomUUID(),birthDate:'2100-01-01'})).rejects.toMatchObject({code:'PT400'});
  });
  it('filters same-specialty doctors, direct tables, unknown fields and cross-doctor commands',async()=>{
    const encounter=await started();expect((await snapshot('b')).patients).toEqual([]);
    expect((await snapshot('c')).patients.map(p=>p.id)).toEqual([otherPatient]);
    await expect(command('b',{type:'note.save',encounterId:encounter.resourceId,expectedVersion:1,content,source:'clinician'})).rejects.toMatchObject({code:'PT404'});
    await expect(command('a',{type:'encounter.start',patientId:patient,issuer:'spoof'})).rejects.toMatchObject({code:'PT400'});
    await client.query('SAVEPOINT forbidden');await client.query('SET LOCAL ROLE orion_crm_app');
    await expect(client.query('SELECT * FROM orion_clinical.note_versions')).rejects.toMatchObject({code:'42501'});
    await client.query('ROLLBACK TO SAVEPOINT forbidden');await client.query('RESET ROLE');
  });
  it('requires consent and explicit review; referral shares only published note with its addressee',async()=>{
    const opened=await started();await expect(command('a',{type:'note.save',encounterId:opened.resourceId,expectedVersion:opened.version,content,source:'ai_assisted'})).rejects.toMatchObject({message:'CLINICAL_CONSENT_REQUIRED'});
    const p=await published();
    const ref=await command('a',{type:'referral.create',encounterId:p.encounterId,expectedVersion:p.version,recipientPractitionerId:'practitioner-b',reason:'Specialist consultation',priority:'routine',reviewAcknowledged:true});
    const recipient=await snapshot('b');expect(recipient.notes).toHaveLength(1);expect(recipient.notes[0].status).toBe('published');expect(recipient.transcript).toEqual([]);
    expect((await snapshot('c')).notes).toEqual([]);
    await expect(command('c',{type:'referral.accept',referralId:ref.resourceId,expectedVersion:1})).rejects.toMatchObject({code:'PT404'});
    const accepted=await command('b',{type:'referral.accept',referralId:ref.resourceId,expectedVersion:1});
    expect(accepted.encounterId).toBeTruthy();expect((await snapshot('b')).encounters.some(e=>e.id===accepted.encounterId&&e.practitionerId==='practitioner-b')).toBe(true);
  });
  it('has immutable versions, CAS and content-bound idempotency',async()=>{
    const first={type:'encounter.start',patientId:patient,idempotencyKey:randomUUID()};
    const a=await command('a',first);expect(await command('a',first)).toEqual({...a,replayed:true});
    await expect(command('a',{...first,patientId:otherPatient})).rejects.toMatchObject({message:'CLINICAL_IDEMPOTENCY_CONFLICT'});
    const c=await consent(a.resourceId,a.version);
    for(const expectedVersion of [null,'2',0,-1,1.2,2147483648]) await expect(command('a',{type:'note.save',encounterId:a.resourceId,expectedVersion,content,source:'clinician'})).rejects.toMatchObject({message:'CLINICAL_INVALID_COMMAND'});
    await expect(command('a',{type:'note.save',encounterId:a.resourceId,content,source:'clinician'})).rejects.toMatchObject({message:'CLINICAL_INVALID_COMMAND'});
    await expect(command('a',{type:'note.save',encounterId:a.resourceId,expectedVersion:1,content,source:'clinician'})).rejects.toMatchObject({message:'CLINICAL_VERSION_CONFLICT'});
    const draft=await command('a',{type:'note.save',encounterId:a.resourceId,expectedVersion:c.version,content,source:'clinician'});
    await client.query('SAVEPOINT immutable');await expect(client.query('UPDATE orion_clinical.note_versions SET content=$1 WHERE id=$2',[content,draft.resourceId])).rejects.toMatchObject({message:'CLINICAL_IMMUTABLE_HISTORY'});await client.query('ROLLBACK TO SAVEPOINT immutable');
    await expect(command('a',{type:'encounter.complete',encounterId:a.resourceId,expectedVersion:draft.version})).rejects.toMatchObject({message:'CLINICAL_REVIEW_REQUIRED'});
  });
  it('closes old clinic-wide RPCs and scopes visual CRM read/write to the mapped doctor',async()=>{
    await client.query('SAVEPOINT legacy');await client.query('SET LOCAL ROLE orion_crm_app');
    await expect(client.query('SELECT public.orion_crm_snapshot_v1($1,$2)',[issuer,`${clinic}-a`])).rejects.toMatchObject({code:'42501'});
    await client.query('ROLLBACK TO SAVEPOINT legacy');await client.query('SET LOCAL ROLE orion_crm_app');
    await expect(client.query("SELECT public.orion_crm_command_v1($1,$2,'{}'::jsonb)",[issuer,`${clinic}-a`])).rejects.toMatchObject({code:'42501'});
    await client.query('ROLLBACK TO SAVEPOINT legacy');await client.query('RESET ROLE');
    const data=(await client.query('SELECT public.orion_clinical_crm_snapshot_v1($1,$2) result',[issuer,`${clinic}-a`])).rows[0].result;
    expect(data.patients.map((p:{id:string})=>p.id)).toEqual([patient]);expect(data.visits).toHaveLength(1);
    await expect(rpc('orion_clinical_crm_command_v1','c',{type:'visit.transition',visitId:visit,expectedVersion:1,action:'arrive',testDataAcknowledged:true,idempotencyKey:randomUUID()})).rejects.toMatchObject({code:'PT404'});
  });
  it('persists speech once, refuses revoked consent and keeps encounter CAS separate',async()=>{
    const e=await started();const c=await consent(e.resourceId,e.version);
    const speech={type:'transcript.append',encounterId:e.resourceId,sessionId:randomUUID(),utteranceIndex:0,inputHash:'a'.repeat(64),text:'Patient speech',role:'unknown',language:'ru',startedAtMs:0,endedAtMs:500,idempotencyKey:randomUUID()};
    const appended=await command('a',speech);expect(appended.version).toBe(1);expect((await command('a',speech)).replayed).toBe(true);
    expect((await snapshot('a')).encounters[0].version).toBe(c.version);
    await consent(e.resourceId,c.version,false);
    await expect(command('a',{...speech,utteranceIndex:1,idempotencyKey:randomUUID()})).rejects.toMatchObject({message:'CLINICAL_CONSENT_REQUIRED'});
  });
});
