/** Explicit, scope-bound directory migration. No passwords and no clinical data. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,writeFileSync,mkdirSync,realpathSync } from 'node:fs';
import { join,resolve,relative,dirname,isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { parseAccessAssignment } from '../lib/domain/access-governance.ts';
import { findLocalStaffDatabase } from './local-account-store.ts';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value);

/** Caller holds a read transaction. Every ID and permission retains its source. */
export function buildDirectoryImportPlan(db,scope){
  if(!validId(scope.organizationId)||!validId(scope.facilityId)||!validId(scope.clinicId)) throw new Error('Three explicit scope IDs are required');
  const facility=db.prepare(`SELECT f.id FROM facilities f JOIN organizations o ON o.id=f.organization_id
    WHERE f.organization_id=? AND f.id=? AND f.status='active' AND o.status='active'`).get(scope.organizationId,scope.facilityId);
  if(!facility) throw new Error('Exact active source organization/facility required');
  const members=db.prepare('SELECT * FROM memberships WHERE organization_id=? AND facility_id=? ORDER BY id').all(scope.organizationId,scope.facilityId);
  const accounts=[];const memberships=[];const assignments=[];const seen=new Set();
  for(const member of members){
    const user=db.prepare('SELECT * FROM users WHERE id=?').get(member.user_id);
    if(!user||!validId(user.id)||!user.external_issuer||!user.external_subject)throw new Error('Source identity missing or malformed; refusing guess');
    if(!seen.has(user.id)){seen.add(user.id);accounts.push({id:user.id,issuer:user.external_issuer,subject:user.external_subject,name:user.display_name,status:user.status==='active'?'active':'disabled',version:user.version??1,sourceHash:sha(user)});}
    memberships.push({id:member.id,userId:member.user_id,status:member.status==='active'?'active':'disabled',interactive:member.role!=='service',version:member.version,sourceHash:sha(member)});
    const rows=db.prepare(`SELECT a.id,a.organization_id,a.facility_id,a.membership_id,a.department_id,
      v.id version_id,v.version,v.status,v.effective_from,v.effective_until,v.roles_json,v.allow_permissions_json,v.deny_permissions_json,
      dv.status department_status
      FROM department_access_assignments a
      JOIN department_access_assignment_heads h ON h.assignment_id=a.id AND h.organization_id=a.organization_id AND h.facility_id=a.facility_id AND h.membership_id=a.membership_id AND h.department_id=a.department_id
      JOIN department_access_assignment_versions v ON v.id=h.current_version_id AND v.assignment_id=a.id AND v.organization_id=a.organization_id AND v.facility_id=a.facility_id AND v.membership_id=a.membership_id AND v.department_id=a.department_id
      JOIN department_heads dh ON dh.department_id=a.department_id AND dh.organization_id=a.organization_id AND dh.facility_id=a.facility_id
      JOIN department_versions dv ON dv.id=dh.current_version_id AND dv.department_id=a.department_id AND dv.organization_id=a.organization_id AND dv.facility_id=a.facility_id
      WHERE a.organization_id=? AND a.facility_id=? AND a.membership_id=? ORDER BY a.id`).all(scope.organizationId,scope.facilityId,member.id);
    for(const row of rows){
      const parsed=parseAccessAssignment({rolesJson:row.roles_json,allowPermissionsJson:row.allow_permissions_json,denyPermissionsJson:row.deny_permissions_json});
      assignments.push({id:row.id,membershipId:member.id,roles:parsed.roles,allowPermissions:parsed.allowPermissions,denyPermissions:parsed.denyPermissions,
        effectivePermissions:parsed.effectivePermissions,status:row.status==='active'&&row.department_status==='active'?'active':'revoked',version:row.version,
        effectiveFrom:new Date(row.effective_from).toISOString(),effectiveUntil:row.effective_until===null?null:new Date(row.effective_until).toISOString(),sourceHash:sha(row)});
    }
  }
  accounts.sort((a,b)=>a.id.localeCompare(b.id));
  const payload={schemaVersion:1,scope,accounts,memberships,assignments};
  return {...payload,sourceSnapshotHash:sha(payload)};
}
function sourcePlan(scope){const db=new DatabaseSync(findLocalStaffDatabase(repository),{readOnly:true});try{db.exec('BEGIN');const plan=buildDirectoryImportPlan(db,scope);db.exec('ROLLBACK');return plan;}finally{db.close();}}
/** Match the previous authentication source, including employees in every scope.
 * No facility filter: an unmappable old login must block cutover, not disappear. */
export function sourceLoginMemberships(db){
  return db.prepare(`SELECT u.id,u.external_issuer issuer,u.external_subject subject,m.id membershipId,
    m.organization_id organizationId,m.facility_id facilityId
    FROM users u JOIN memberships m ON m.user_id=u.id
    WHERE u.status='active' AND m.status='active' AND m.role<>'service'
    ORDER BY u.id,m.id`).all();
}
export function assertLoginCoverage(required,actual){
  const signature=row=>JSON.stringify([row.id,row.issuer,row.subject,row.membershipId,row.organizationId,row.facilityId]);
  const expected=new Set(required.map(signature));const imported=new Set(actual.map(signature));
  if(expected.size!==required.length||imported.size!==actual.length||expected.size!==imported.size||[...expected].some(value=>!imported.has(value)))throw new Error('Global login membership coverage differs; import every exact source scope before activation');
}
async function main(){
  const action=process.argv[2];
  if(!['plan','apply','verify','verify-all','activate'].includes(action)||(action==='plan'?process.argv.length!==6:process.argv.length!==4)) throw new Error('Usage: clinical-directory-import.mjs plan <org> <facility> <clinic> OR apply|verify|verify-all|activate <private-plan-path>');
  if(!process.env.LOCALAPPDATA)throw new Error('Private local runtime required');
  const runtime=join(process.env.LOCALAPPDATA,'ORION-Clinic-CRM');const directory=join(runtime,'directory-imports');
  const marker=JSON.parse(readFileSync(join(runtime,'cluster-owner.json'),'utf8'));
  if(marker.kind!=='orion-crm-local-v1'||marker.port!==55432||resolve(marker.data).toLowerCase()!==resolve(runtime,'data').toLowerCase())throw new Error('Owned local PostgreSQL required');
  if(action==='plan'){
    const plan=sourcePlan({organizationId:process.argv[3],facilityId:process.argv[4],clinicId:process.argv[5]});
    mkdirSync(directory,{recursive:true});const path=join(directory,`${new Date().toISOString().replace(/[:.]/g,'-')}-${plan.sourceSnapshotHash.slice(0,12)}.json`);
    writeFileSync(path,JSON.stringify(plan,null,2),{flag:'wx',mode:0o600});
    console.log(JSON.stringify({mode:'read_only_plan',path,accounts:plan.accounts.length,memberships:plan.memberships.length,assignments:plan.assignments.length,sourceSnapshotHash:plan.sourceSnapshotHash}));return;
  }
  const path=realpathSync(process.argv[3]);const offset=relative(realpathSync(directory),path);
  if(isAbsolute(offset)||offset==='..'||offset.startsWith('..\\')||offset.startsWith('../'))throw new Error('Only a private directory-import plan is accepted');
  const plan=JSON.parse(readFileSync(path,'utf8'));const fresh=sourcePlan(plan.scope);
  // Trust the new read, not editable input payload. Source changes require a new
  // report and review; usernames, roles and departments are never fuzzy-matched.
  if(plan.sourceSnapshotHash!==fresh.sourceSnapshotHash||sha(plan)!==sha(fresh))throw new Error('Source/plan changed; generate and review a fresh import plan');
  const admin=JSON.parse(readFileSync(join(runtime,'admin.json'),'utf8'));
  if(admin.host!=='127.0.0.1'||admin.port!==55432||admin.user!=='postgres'||!/^[A-Za-z0-9_-]{32,128}$/.test(admin.password))throw new Error('Invalid explicit local admin configuration');
  const {password}=admin;const client=new pg.Client({host:'127.0.0.1',port:55432,database:'orion_crm_local',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000,statement_timeout:15000});
  await client.connect();
  try{
    if(realpathSync((await client.query('SHOW data_directory')).rows[0].data_directory).toLowerCase()!==realpathSync(marker.data).toLowerCase())throw new Error('Wrong PostgreSQL cluster');
    const readOnly=action==='verify-all';
    await client.query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');
    if(!readOnly)await client.query('SELECT pg_advisory_xact_lock(7791324003)');
    const mode=(await client.query('SELECT * FROM orion_directory.runtime WHERE id=1'+(readOnly?'':' FOR UPDATE'))).rows[0];
    const clinic=fresh.scope.clinicId;
    if(action==='apply'){
      if(mode.source!=='legacy_d1')throw new Error('Directory is active; source imports are closed permanently');
      if(!(await client.query('SELECT 1 FROM orion_crm.clinics WHERE id=$1 AND active',[clinic])).rowCount)throw new Error('Explicit target clinic does not exist');
      const prior=(await client.query('SELECT * FROM orion_directory.scope_maps WHERE source_organization_id=$1 AND source_facility_id=$2',[fresh.scope.organizationId,fresh.scope.facilityId])).rows[0];
      if(prior){if(prior.clinic_id!==clinic||prior.source_snapshot_hash!==fresh.sourceSnapshotHash)throw new Error('Existing exact scope import differs; refusing overwrite');}
      else{
        for(const account of fresh.accounts){
          const old=(await client.query('SELECT * FROM orion_directory.accounts WHERE id=$1 OR (issuer=$2 AND subject=$3)',[account.id,account.issuer,account.subject])).rows;
          if(old.length){if(old.length!==1||old[0].id!==account.id||old[0].issuer!==account.issuer||old[0].subject!==account.subject||old[0].source_hash!==account.sourceHash)throw new Error('Existing identity differs; refusing account merge');}
          else await client.query("INSERT INTO orion_directory.accounts(id,issuer,subject,display_name,status,version,source,legacy_user_id,source_hash) VALUES($1,$2,$3,$4,$5,$6,'legacy_d1',$1,$7)",[account.id,account.issuer,account.subject,account.name,account.status,account.version,account.sourceHash]);
        }
        for(const membership of fresh.memberships)await client.query('INSERT INTO orion_directory.memberships(clinic_id,id,user_id,status,version,interactive,source_membership_id) VALUES($1,$2,$3,$4,$5,$6,$2)',[clinic,membership.id,membership.userId,membership.status,membership.version,membership.interactive]);
        for(const assignment of fresh.assignments)await client.query('INSERT INTO orion_directory.assignments(clinic_id,id,membership_id,source_assignment_id,roles,allow_permissions,deny_permissions,status,version,effective_from,effective_until) VALUES($1,$2,$3,$2,$4,$5,$6,$7,$8,$9,$10)',[clinic,assignment.id,assignment.membershipId,assignment.roles,assignment.allowPermissions,assignment.denyPermissions,assignment.status,assignment.version,assignment.effectiveFrom,assignment.effectiveUntil]);
        await client.query('INSERT INTO orion_directory.scope_maps(source_organization_id,source_facility_id,clinic_id,source_snapshot_hash) VALUES($1,$2,$3,$4)',[fresh.scope.organizationId,fresh.scope.facilityId,clinic,fresh.sourceSnapshotHash]);
        await client.query("INSERT INTO orion_directory.audit_events(clinic_id,action,resource_id,after_state,reason) VALUES($1,'directory.import',$1,$2,'Exact local D1 scope import; no credentials or clinical records')",[clinic,JSON.stringify({sourceSnapshotHash:fresh.sourceSnapshotHash,accounts:fresh.accounts.length,memberships:fresh.memberships.length,assignments:fresh.assignments.length})]);
      }
    }
    const counts=(await client.query(`SELECT (SELECT count(*)::int FROM orion_directory.memberships WHERE clinic_id=$1) memberships,
      (SELECT count(*)::int FROM orion_directory.assignments WHERE clinic_id=$1) assignments,
      (SELECT count(DISTINCT user_id)::int FROM orion_directory.memberships WHERE clinic_id=$1) accounts`,[clinic])).rows[0];
    if(counts.accounts!==fresh.accounts.length||counts.memberships!==fresh.memberships.length||counts.assignments!==fresh.assignments.length)throw new Error('Directory import counts differ');
    if(!(await client.query('SELECT 1 FROM orion_directory.scope_maps WHERE source_organization_id=$1 AND source_facility_id=$2 AND clinic_id=$3 AND source_snapshot_hash=$4',[fresh.scope.organizationId,fresh.scope.facilityId,clinic,fresh.sourceSnapshotHash])).rowCount)throw new Error('Exact source scope/hash mapping missing');
    for(const account of fresh.accounts){const row=(await client.query('SELECT id,issuer,subject,display_name,status,version,source_hash FROM orion_directory.accounts WHERE id=$1',[account.id])).rows[0];
      if(!row||row.issuer!==account.issuer||row.subject!==account.subject||row.display_name!==account.name||row.status!==account.status||row.version!==account.version||row.source_hash!==account.sourceHash)throw new Error('Directory identity content differs');}
    for(const membership of fresh.memberships){const row=(await client.query('SELECT id,user_id,status,version,interactive,source_membership_id FROM orion_directory.memberships WHERE clinic_id=$1 AND id=$2',[clinic,membership.id])).rows[0];
      if(!row||row.user_id!==membership.userId||row.status!==membership.status||row.version!==membership.version||row.interactive!==membership.interactive||row.source_membership_id!==membership.id)throw new Error('Directory membership content differs');}
    for(const assignment of fresh.assignments){const row=(await client.query('SELECT id,membership_id,roles,allow_permissions,deny_permissions,status,version,effective_from,effective_until,orion_directory.effective_permissions(roles,allow_permissions,deny_permissions) permissions FROM orion_directory.assignments WHERE clinic_id=$1 AND id=$2',[clinic,assignment.id])).rows[0];
      if(!row||row.membership_id!==assignment.membershipId||row.status!==assignment.status||row.version!==assignment.version||row.effective_from.toISOString()!==assignment.effectiveFrom||(row.effective_until?.toISOString()??null)!==assignment.effectiveUntil||JSON.stringify(row.roles)!==JSON.stringify(assignment.roles)||JSON.stringify(row.allow_permissions)!==JSON.stringify(assignment.allowPermissions)||JSON.stringify(row.deny_permissions)!==JSON.stringify(assignment.denyPermissions)||JSON.stringify(row.permissions)!==JSON.stringify(assignment.effectivePermissions))throw new Error('Directory assignment/permission content differs');}
    const unmapped=(await client.query(`SELECT p.id FROM orion_clinical.practitioners p WHERE p.clinic_id=$1 AND p.active AND NOT EXISTS(
      SELECT 1 FROM orion_directory.current_assignments a WHERE a.clinic_id=p.clinic_id AND a.issuer=p.issuer AND a.subject=p.subject AND 'doctor'=ANY(a.roles) AND 'encounter.manage'=ANY(a.permissions) AND 'encounter.read'=ANY(a.permissions))`,[clinic])).rows;
    if(unmapped.length)throw new Error('An active clinical identity is not preserved by source authority');
    if(action==='apply')await client.query('UPDATE orion_directory.runtime SET import_complete=true,revision=revision+1 WHERE id=1');
    if(action==='activate'||action==='verify-all'){
      if(mode.source!=='legacy_d1'||!mode.import_complete)throw new Error('A verified inactive import is required');
      const db=new DatabaseSync(findLocalStaffDatabase(repository),{readOnly:true});
      try{
        db.exec('BEGIN');
        const importedScopes=(await client.query('SELECT * FROM orion_directory.scope_maps ORDER BY clinic_id')).rows;
        for(const mapped of importedScopes){
          const current=buildDirectoryImportPlan(db,{organizationId:mapped.source_organization_id,facilityId:mapped.source_facility_id,clinicId:mapped.clinic_id});
          if(current.sourceSnapshotHash!==mapped.source_snapshot_hash)throw new Error('An imported scope changed at source; global activation is forbidden');
        }
        const actual=(await client.query(`SELECT u.id,u.issuer,u.subject,m.source_membership_id "membershipId",s.source_organization_id "organizationId",s.source_facility_id "facilityId"
          FROM orion_directory.accounts u JOIN orion_directory.memberships m ON m.user_id=u.id
          JOIN orion_directory.scope_maps s ON s.clinic_id=m.clinic_id JOIN orion_crm.clinics c ON c.id=m.clinic_id AND c.active
          WHERE u.status='active' AND m.status='active' AND m.interactive ORDER BY u.id,m.id`)).rows;
        assertLoginCoverage(sourceLoginMemberships(db),actual);
        db.exec('ROLLBACK');
      }finally{db.close();}
      if(!(await client.query("SELECT 1 FROM orion_directory.current_assignments WHERE 'access.manage'=ANY(permissions) AND NOT 'service'=ANY(roles)")).rowCount)throw new Error('No preserved current administrator; global cutover forbidden');
      if((await client.query(`SELECT 1 FROM orion_clinical.practitioners p WHERE p.active AND NOT EXISTS(
        SELECT 1 FROM orion_directory.current_assignments a WHERE a.clinic_id=p.clinic_id AND a.issuer=p.issuer AND a.subject=p.subject
        AND 'doctor'=ANY(a.roles) AND 'encounter.read'=ANY(a.permissions) AND 'encounter.manage'=ANY(a.permissions))`)).rowCount)throw new Error('Global clinical identity coverage differs; cutover forbidden');
    }
    if(action==='activate'){
      await client.query("UPDATE orion_directory.runtime SET source='postgres',activated_at=clock_timestamp(),revision=revision+1 WHERE id=1");
      const allMembers=(await client.query('SELECT clinic_id,user_id FROM orion_directory.memberships ORDER BY clinic_id,user_id')).rows;
      for(const member of allMembers)await client.query('SELECT orion_directory.sync_clinical_projection($1,$2)',[member.clinic_id,member.user_id]);
    }
    if(action==='verify'||action==='verify-all')await client.query('ROLLBACK');else await client.query('COMMIT');
    console.log(JSON.stringify({action,clinicId:clinic,counts,permissionsMatch:true,sourceSnapshotHash:fresh.sourceSnapshotHash,
      ...(action==='verify-all'||action==='activate'?{globalLoginCoverageMatch:true}:{}),identitySource:action==='activate'?'postgres':mode.source,credentialsChanged:false,d1Changed:false}));
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{await client.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{
  console.error(error instanceof Error&&!(error instanceof SyntaxError)&&!('severity'in error)&&!('stderr'in error)?error.message:'Directory import failed; no credentials, SQL or person details printed.');process.exitCode=1;
});
