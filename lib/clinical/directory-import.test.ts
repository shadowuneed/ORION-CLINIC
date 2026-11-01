import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,it,expect} from 'vitest';
import {buildDirectoryImportPlan,sourceLoginMemberships,assertLoginCoverage} from '../../scripts/clinical-directory-import.mjs';
import {directoryCommandSchema} from './directory-contracts';
let db:DatabaseSync;
function fixture(){
  db=new DatabaseSync(':memory:');db.exec(`
    CREATE TABLE organizations(id TEXT PRIMARY KEY,status TEXT);CREATE TABLE facilities(id TEXT PRIMARY KEY,organization_id TEXT,status TEXT);
    CREATE TABLE users(id TEXT PRIMARY KEY,external_issuer TEXT,external_subject TEXT,display_name TEXT,status TEXT,version INTEGER);
    CREATE TABLE memberships(id TEXT PRIMARY KEY,organization_id TEXT,facility_id TEXT,user_id TEXT,role TEXT,status TEXT,version INTEGER);
    CREATE TABLE department_access_assignments(id TEXT PRIMARY KEY,organization_id TEXT,facility_id TEXT,membership_id TEXT,department_id TEXT);
    CREATE TABLE department_access_assignment_heads(assignment_id TEXT,organization_id TEXT,facility_id TEXT,membership_id TEXT,department_id TEXT,current_version_id TEXT);
    CREATE TABLE department_access_assignment_versions(id TEXT,assignment_id TEXT,organization_id TEXT,facility_id TEXT,membership_id TEXT,department_id TEXT,version INTEGER,status TEXT,effective_from INTEGER,effective_until INTEGER,roles_json TEXT,allow_permissions_json TEXT,deny_permissions_json TEXT);
    CREATE TABLE department_heads(department_id TEXT,organization_id TEXT,facility_id TEXT,current_version_id TEXT);
    CREATE TABLE department_versions(id TEXT,department_id TEXT,organization_id TEXT,facility_id TEXT,status TEXT);
    INSERT INTO organizations VALUES('org-a','active'),('org-b','active');INSERT INTO facilities VALUES('fac-a','org-a','active'),('fac-b','org-b','active');
    INSERT INTO users VALUES('user-a','issuer-a','subject-a','Same displayed name','active',3),('user-b','issuer-b','subject-b','Same displayed name','active',1),('unassigned','issuer-a','subject-unassigned','Active employee','active',1);
    INSERT INTO memberships VALUES('member-a','org-a','fac-a','user-a','clinician','active',2),('member-b','org-b','fac-b','user-b','clinician','active',1),('member-empty','org-a','fac-a','unassigned','nurse','active',1);
    INSERT INTO department_access_assignments VALUES('assignment-a','org-a','fac-a','member-a','dept-a');
    INSERT INTO department_access_assignment_heads VALUES('assignment-a','org-a','fac-a','member-a','dept-a','version-a');
    INSERT INTO department_access_assignment_versions VALUES('version-a','assignment-a','org-a','fac-a','member-a','dept-a',4,'active',1700000000000,1800000000000,'["doctor","administrator"]','[]','["encounter.manage"]');
    INSERT INTO department_heads VALUES('dept-a','org-a','fac-a','dept-version-a');INSERT INTO department_versions VALUES('dept-version-a','dept-a','org-a','fac-a','active');
  `);return db;
}
const scope={organizationId:'org-a',facilityId:'fac-a',clinicId:'crm-clinic-local'};
afterEach(()=>{if(db?.isOpen)db.close();});
describe('exact D1 directory import plan',()=>{
  it('retains identities and memberships without name matching or widening roles',()=>{
    const plan=buildDirectoryImportPlan(fixture(),scope);
    expect(plan.accounts.map(a=>a.id)).toEqual(['unassigned','user-a']);expect(plan.memberships).toHaveLength(2);expect(plan.assignments).toHaveLength(1);
    expect(plan.accounts.find(a=>a.id==='user-a')).toMatchObject({issuer:'issuer-a',subject:'subject-a',version:3});
    expect(plan.assignments[0]).toMatchObject({id:'assignment-a',membershipId:'member-a',version:4,roles:['doctor','administrator'],denyPermissions:['encounter.manage'],effectiveUntil:'2027-01-15T08:00:00.000Z'});
    expect(plan.assignments[0].effectivePermissions).toContain('access.manage');expect(plan.assignments[0].effectivePermissions).not.toContain('encounter.manage');
    expect(plan.sourceSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('rejects a mismatched org/fac and reflects source changes in the consistency hash',()=>{
    fixture();expect(()=>buildDirectoryImportPlan(db,{...scope,organizationId:'org-b'})).toThrow('Exact active source');
    const before=buildDirectoryImportPlan(db,scope);db.exec("UPDATE department_access_assignment_versions SET deny_permissions_json='[]',version=5");
    expect(buildDirectoryImportPlan(db,scope).sourceSnapshotHash).not.toBe(before.sourceSnapshotHash);
  });
  it('does not resurrect a disabled department or invent assignments for ordinary staff',()=>{
    fixture();db.exec("UPDATE department_versions SET status='disabled'");const plan=buildDirectoryImportPlan(db,scope);
    expect(plan.assignments[0].status).toBe('revoked');expect(plan.assignments.some(a=>a.membershipId==='member-empty')).toBe(false);
  });
  it('preserves the non-interactive service-account exclusion',()=>{
    fixture();db.exec("UPDATE memberships SET role='service' WHERE id='member-empty'");
    expect(buildDirectoryImportPlan(db,scope).memberships.find(m=>m.id==='member-empty')?.interactive).toBe(false);
  });
  it('requires every existing login scope, including an employee with no assignment or administrator',()=>{
    fixture();const required=sourceLoginMemberships(db);
    expect(required).toHaveLength(3);
    expect(()=>assertLoginCoverage(required,required.filter((row:{organizationId:string})=>row.organizationId==='org-a'))).toThrow('Global login membership coverage');
    expect(()=>assertLoginCoverage(required,required.map((row:{id:string;subject:string})=>row.id==='user-b'?{...row,subject:'guessed'}:row))).toThrow('Global login membership coverage');
    expect(()=>assertLoginCoverage(required,required)).not.toThrow();
    const secondary=buildDirectoryImportPlan(db,{organizationId:'org-b',facilityId:'fac-b',clinicId:'separate-clinic'});
    expect(secondary.accounts.map(row=>row.id)).toEqual(['user-b']);expect(secondary.assignments).toEqual([]);
  });
  it('validates administrative changes without accepting client identity or ambiguous overrides',()=>{
    const grant={type:'assignment.create',clinicId:'clinic',membershipId:'member',roles:['doctor'],allowPermissions:[],denyPermissions:[],staffId:'staff',specialty:'general',reason:'Reviewed staffing',idempotencyKey:'e829bd2e-7ce5-4d4a-a828-03e4bed6a5f6'};
    expect(directoryCommandSchema.safeParse(grant).success).toBe(true);
    expect(directoryCommandSchema.safeParse({...grant,issuer:'spoof'}).success).toBe(false);
    expect(directoryCommandSchema.safeParse({...grant,roles:['service','doctor']}).success).toBe(false);
    expect(directoryCommandSchema.safeParse({...grant,allowPermissions:['encounter.manage'],denyPermissions:['encounter.manage']}).success).toBe(false);
  });
});
