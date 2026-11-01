/** Additive local clinical module. Never resets or copies a database automatically. */
import { readFileSync, readdirSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const action=process.argv[2];
if(!['migrate','backup','staff','link-practitioner','import-plan'].includes(action) ||
  (action==='link-practitioner'?process.argv.length!==6:process.argv.length!==3)) throw new Error('Usage: clinical-local-postgres.mjs migrate|backup|staff|import-plan OR link-practitioner <local-user-id> <CRM-staff-id> <specialty>');
if(!process.env.LOCALAPPDATA) throw new Error('Dedicated local runtime required');
const runtime=join(process.env.LOCALAPPDATA,'ORION-Clinic-CRM');
function privateConfig(name){try{return JSON.parse(readFileSync(join(runtime,name),'utf8'));}catch{throw new Error('Private local runtime configuration could not be read');}}
const marker=privateConfig('cluster-owner.json');
const data=join(runtime,'data');
if(marker.kind!=='orion-crm-local-v1'||marker.port!==55432||resolve(marker.data).toLowerCase()!==resolve(data).toLowerCase()) throw new Error('Owned PostgreSQL marker required');
const admin=privateConfig('admin.json');
if(admin.host!=='127.0.0.1'||admin.port!==55432||admin.user!=='postgres'||!/^[A-Za-z0-9_-]{32,128}$/.test(admin.password)) throw new Error('Invalid dedicated local configuration');
const { password }=admin;
const client=new pg.Client({host:'127.0.0.1',port:55432,user:'postgres',password,database:'orion_crm_local',ssl:false,connectionTimeoutMillis:3000,statement_timeout:15000});
const sha=value=>createHash('sha256').update(value).digest('hex');
try{
  await client.connect();
  if(realpathSync((await client.query('SHOW data_directory')).rows[0].data_directory).toLowerCase()!==realpathSync(data).toLowerCase()) throw new Error('Wrong PostgreSQL data directory');
  if((await client.query('SELECT current_database() n')).rows[0].n!=='orion_crm_local') throw new Error('Wrong PostgreSQL database');
  if(action==='backup'){
    const directory=join(runtime,'backups');mkdirSync(directory,{recursive:true});
    const path=join(directory,`orion-unified-${new Date().toISOString().replace(/[:.]/g,'-')}.dump`);
    execFileSync(join(runtime,'postgresql-17.11','pgsql','bin','pg_dump.exe'),['-h','127.0.0.1','-p','55432','-U','postgres','-d','orion_crm_local','-Fc','-f',path],{windowsHide:true,stdio:'ignore',env:{...process.env,PGPASSWORD:password}});
    console.log(`Unified PostgreSQL backup saved: ${path}`);
  }
  if(action==='migrate'){
    await client.query('SELECT pg_advisory_lock(7791324002)');
    try{
      await client.query('CREATE TABLE IF NOT EXISTS public.orion_clinical_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
      await client.query('REVOKE ALL ON public.orion_clinical_migrations FROM PUBLIC,orion_crm_app');
      const directory=join(repository,'db','clinical');
      for(const name of readdirSync(directory).filter(f=>/^\d{4}_[a-z_]+\.sql$/.test(f)).sort()){
        const sql=readFileSync(join(directory,name),'utf8');const checksum=sha(sql);
        const old=(await client.query('SELECT checksum FROM public.orion_clinical_migrations WHERE name=$1',[name])).rows[0];
        if(old){if(old.checksum!==checksum) throw new Error(`Applied clinical migration changed: ${name}`);console.log(`Already applied: ${name}`);continue;}
        await client.query('BEGIN');
        try{
          await client.query(sql.replace(/^([\s\S]*?)BEGIN;\s*/,'$1').replace(/COMMIT;\s*$/,''));
          await client.query('INSERT INTO public.orion_clinical_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);await client.query('COMMIT');
          console.log(`Applied additive clinical migration: ${name}`);
        }catch(error){await client.query('ROLLBACK');throw error;}
      }
    }finally{await client.query('SELECT pg_advisory_unlock(7791324002)');}
  }
  if(action==='staff'){
    console.log(JSON.stringify((await client.query("SELECT id,name,role FROM orion_crm.staff WHERE clinic_id='crm-clinic-local' ORDER BY id")).rows));
  }
  if(action==='link-practitioner'){
    const [, , , userId,staffId,specialty]=process.argv;
    if(!/^[A-Za-z0-9_-]{1,160}$/.test(userId)||!/^[A-Za-z0-9_-]{1,160}$/.test(staffId)||!specialty.trim()||specialty.length>160) throw new Error('Invalid explicit practitioner mapping');
    const {findLocalStaffDatabase,readLocalStaff,localAccountPaths}=await import('./local-account-store.ts');
    const source=findLocalStaffDatabase(repository);const person=readLocalStaff(source).find(p=>p.id===userId);
    if(!person) throw new Error('Exact active local identity required');
    const d1=new DatabaseSync(source,{readOnly:true});const auth=new DatabaseSync(localAccountPaths(repository).database,{readOnly:true});
    try{
      const now=Date.now();
      if(!d1.prepare(`SELECT 1 FROM encounter_access_assignment_permissions a JOIN memberships m ON m.id=a.membership_id
        WHERE m.user_id=? AND a.can_read=1 AND a.can_manage=1 AND a.effective_from<=? AND (a.effective_until IS NULL OR a.effective_until>?) LIMIT 1`).get(userId,now,now)) throw new Error('Active local doctor assignment required; administrator alone is insufficient');
      if(!auth.prepare('SELECT 1 FROM local_accounts WHERE user_id=? AND issuer=? AND subject=?').get(userId,person.issuer,person.subject)) throw new Error('Provisioned exact local login required');
    }finally{d1.close();auth.close();}
    await client.query('BEGIN');
    try{
      const staff=(await client.query("SELECT id FROM orion_crm.staff WHERE clinic_id='crm-clinic-local' AND id=$1 AND role='doctor' FOR SHARE",[staffId])).rows[0];
      if(!staff) throw new Error('An exact existing doctor staff row is required');
      const existing=(await client.query('SELECT clinic_id,id,staff_id,issuer,subject,specialty,active FROM orion_clinical.practitioners WHERE (issuer=$1 AND subject=$2) OR (clinic_id=$3 AND staff_id=$4)',[person.issuer,person.subject,'crm-clinic-local',staffId])).rows;
      if(existing.length){
        if(existing.length!==1||existing[0].staff_id!==staffId||existing[0].issuer!==person.issuer||existing[0].subject!==person.subject||existing[0].specialty!==specialty||!existing[0].active) throw new Error('Existing mapping differs; refusing overwrite or reactivation');
      }else{
        const oldGrant=(await client.query('SELECT clinic_id,active,can_read FROM orion_crm.actor_grants WHERE issuer=$1 AND subject=$2 FOR SHARE',[person.issuer,person.subject])).rows[0];
        if(oldGrant&&(!oldGrant.active||!oldGrant.can_read||oldGrant.clinic_id!=='crm-clinic-local')) throw new Error('Existing CRM grant is disabled or belongs to another clinic');
        if(!oldGrant) await client.query("INSERT INTO orion_crm.actor_grants(id,clinic_id,issuer,subject,label,can_read,can_manage) VALUES($1,'crm-clinic-local',$2,$3,$4,true,true)",[`clinical-grant-${userId}`,person.issuer,person.subject,person.name]);
        await client.query("INSERT INTO orion_clinical.practitioners(clinic_id,id,staff_id,issuer,subject,display_name,specialty,verified_at,verification_reference) VALUES('crm-clinic-local',$1,$2,$3,$4,$5,$6,clock_timestamp(),$7)",[`practitioner-${userId}`,staffId,person.issuer,person.subject,person.name,specialty,`local-doctor-assignment:${userId}`]);
      }
      await client.query('COMMIT');console.log(`Verified practitioner mapping: ${userId} -> ${staffId}. No password or D1 changes.`);
    }catch(error){await client.query('ROLLBACK');throw error;}
  }
  if(action==='import-plan'){
    const {findLocalStaffDatabase}=await import('./local-account-store.ts');
    const source=findLocalStaffDatabase(repository);const db=new DatabaseSync(source,{readOnly:true});
    try{
      db.exec('BEGIN');
      // Exact legacy keys and hashes only, no names/clinical text in the manifest.
      const records=[];
      for(const table of ['patients','encounters','protocol_versions']){
        for(const row of db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()) records.push({table,sourceTenant:`${row.organization_id}/${row.facility_id}`,sourceId:row.id,sourceSha256:sha(JSON.stringify(row))});
      }
      const target=(await client.query("SELECT count(*)::int patients FROM orion_crm.patients WHERE clinic_id='crm-clinic-local'")).rows[0];
      const path=join(runtime,`clinical-import-plan-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
      writeFileSync(path,JSON.stringify({version:1,mode:'read_only_plan',source:'local_d1',target:'orion_crm_local',targetPatients:target.patients,records,
        blockers:['Exact patient/practitioner mappings and consent/protocol lineage must be reviewed before import. No name-based merging or automatic reinterpretation of old drafts.']},null,2),{mode:0o600,flag:'wx'});
      db.exec('ROLLBACK');console.log(`Read-only import manifest saved: ${path}; ${records.length} source records. No data imported.`);
    }finally{db.close();}
  }
}catch(error){
  console.error(error instanceof Error&&!(error instanceof SyntaxError)&&!('severity'in error)&&!('stderr'in error)?error.message:'Local clinical PostgreSQL operation failed; no SQL, clinical text or credentials were printed.');process.exitCode=1;
}finally{await client.end().catch(()=>undefined);}
