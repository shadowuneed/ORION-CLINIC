import { z } from 'zod';
import { organizationRoles,clinicPermissions } from '../domain/access-governance';
const id=z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/);
const revision=z.number().int().positive().max(2147483647);
const strings=<T extends readonly [string,...string[]]>(values:T)=>z.array(z.enum(values)).max(values.length).refine(a=>new Set(a).size===a.length);
const roles=strings(organizationRoles).min(1);
const permissions=strings(clinicPermissions);
const command={clinicId:id,idempotencyKey:z.string().uuid()};
const grant={roles,allowPermissions:permissions,denyPermissions:permissions,staffId:id.nullable(),specialty:z.string().trim().min(1).max(160).nullable(),reason:z.string().trim().min(1).max(1000)};
export const directoryCommandSchema=z.discriminatedUnion('type',[
  z.object({...command,type:z.literal('account.create'),name:z.string().trim().min(2).max(160)}).strict(),
  z.object({...command,...grant,type:z.literal('assignment.create'),membershipId:id}).strict(),
  z.object({...command,...grant,type:z.literal('assignment.replace'),assignmentId:id,expectedVersion:revision}).strict(),
  z.object({...command,type:z.literal('assignment.revoke'),assignmentId:id,expectedVersion:revision,reason:grant.reason}).strict(),
  z.object({...command,type:z.literal('membership.disable'),membershipId:id,expectedVersion:revision,reason:grant.reason}).strict(),
]).superRefine((c,ctx)=>{
  if('roles'in c){
    if(c.roles.includes('service')&&c.roles.length!==1)ctx.addIssue({code:'custom',message:'Service role cannot be combined'});
    if(c.allowPermissions.some(p=>c.denyPermissions.includes(p)))ctx.addIssue({code:'custom',message:'Conflicting permission overrides'});
  }
});
export type DirectoryCommand=z.infer<typeof directoryCommandSchema>;
export const directoryModeSchema=z.object({source:z.enum(['legacy_d1','postgres']),revision,importComplete:z.boolean()}).strict();
export const directoryPrincipalSchema=z.object({id,issuer:z.string().min(1).max(256),subject:z.string().min(1).max(256),name:z.string().min(1).max(160)}).strict();
export const directorySnapshotSchema=z.object({schemaVersion:z.literal(1),clinic:z.object({id,name:z.string().min(1).max(160)}).strict(),
  accounts:z.array(z.object({id,name:z.string().min(1).max(160),status:z.enum(['active','disabled']),version:revision}).strict()).max(1000),
  memberships:z.array(z.object({id,userId:id,status:z.enum(['active','disabled']),version:revision,interactive:z.boolean()}).strict()).max(1000),
  assignments:z.array(z.object({id,membershipId:id,roles,allowPermissions:permissions,denyPermissions:permissions,effectivePermissions:permissions,version:revision,status:z.enum(['active','revoked']),effectiveFrom:z.string().datetime({precision:3}),effectiveUntil:z.string().datetime({precision:3}).nullable(),staffId:id.nullable(),specialty:z.string().min(1).max(160).nullable()}).strict()).max(5000),
  staff:z.array(z.object({id,name:z.string().min(1).max(160),role:z.enum(['doctor','nurse','registrar','support'])}).strict()).max(200),
  generatedAt:z.string().datetime({precision:3}),
}).strict();
export type DirectorySnapshot=z.infer<typeof directorySnapshotSchema>;
export const directoryCommandResultSchema=z.object({resourceId:id,userId:id,version:revision,replayed:z.boolean()}).strict();
