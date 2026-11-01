/** Dedicated restore exercise. Never connects to or writes the live database. */
import {readFileSync,realpathSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve,relative,isAbsolute,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import pg from 'pg';

const schemas=new Set(['public','orion_crm','orion_clinical','orion_directory']);
const quote=value=>'"'+value.replaceAll('"','""')+'"';
export function assertDrillDatabase(name){
  if(typeof name!=='string'||!/^orion_restore_drill_[a-f0-9]{32}$/.test(name))throw new Error('Dedicated generated restore database required');
}
export function archiveCopyCounts(sql){
  const counts=[];let table=null;let rows=0;
  for(const line of sql.split(/\r?\n/)){
    if(table){
      if(line==='\\.'){counts.push({...table,rows});table=null;rows=0;}else rows++;
      continue;
    }
    if(line.startsWith('COPY ')){
      const match=/^COPY "?([a-z_]+)"?\."?([a-z_]+)"? \(.+\) FROM stdin;$/.exec(line);
      if(!match||!schemas.has(match[1]))throw new Error('Unexpected archive table format');
      table={schema:match[1],table:match[2]};
    }
  }
  if(table||!counts.length||new Set(counts.map(row=>row.schema+'.'+row.table)).size!==counts.length)throw new Error('Incomplete or ambiguous archive COPY blocks');
  return counts;
}
async function main(){
  if(process.argv.length!==3||!isAbsolute(process.argv[2]))throw new Error('Usage: clinical-restore-drill.mjs <absolute-private-backup-path>');
  if(!process.env.LOCALAPPDATA)throw new Error('Private local runtime required');
  const runtime=join(process.env.LOCALAPPDATA,'ORION-Clinic-CRM');
  let marker,admin;
  try{marker=JSON.parse(readFileSync(join(runtime,'cluster-owner.json'),'utf8'));admin=JSON.parse(readFileSync(join(runtime,'admin.json'),'utf8'));}catch{throw new Error('Private configuration is unavailable');}
  if(marker.kind!=='orion-crm-local-v1'||marker.port!==55432||resolve(marker.data).toLowerCase()!==resolve(runtime,'data').toLowerCase())throw new Error('Owned loopback cluster required');
  if(admin.host!=='127.0.0.1'||admin.port!==55432||admin.user!=='postgres'||typeof admin.password!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(admin.password))throw new Error('Exact local admin configuration required');
  const backup=realpathSync(process.argv[2]);const offset=relative(realpathSync(join(runtime,'backups')),backup);
  if(isAbsolute(offset)||offset==='..'||offset.startsWith('..\\')||offset.startsWith('../')||!/^orion-(?:unified|crm)-[0-9TZ.-]+\.dump$/.test(basename(backup)))throw new Error('Only an explicit private ORION backup is accepted');
  const archive=readFileSync(backup);
  if(archive.subarray(0,5).toString('ascii')!=='PGDMP')throw new Error('PostgreSQL custom archive required');
  const digest=createHash('sha256').update(archive).digest('hex');
  const {password}=admin;
  const program=join(runtime,'postgresql-17.11','pgsql','bin','pg_restore.exe');
  // Arguments pin every connection setting. Credentials never enter argv/logs.
  const env={...process.env,PGHOST:'127.0.0.1',PGPORT:'55432',PGUSER:'postgres',PGPASSWORD:password,PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'3'};
  for(const key of ['PGDATABASE','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])delete env[key];
  // Parse COPY row counts in memory only. Never print or write patient records.
  let expected;
  try{expected=archiveCopyCounts(execFileSync(program,['--data-only','--file=-',backup],{windowsHide:true,env,stdio:['ignore','pipe','pipe'],encoding:'utf8',maxBuffer:32*1024*1024,timeout:60000}));}catch{throw new Error('Archive data inventory could not be read safely');}
  const target='orion_restore_drill_'+randomUUID().replaceAll('-','');assertDrillDatabase(target);
  let control,restored,created=false,stage='create';
  const connect=async database=>{
    if(database!=='postgres')assertDrillDatabase(database);
    const client=new pg.Client({host:'127.0.0.1',port:55432,user:'postgres',password,database,ssl:false,connectionTimeoutMillis:3000,statement_timeout:20000});
    await client.connect();
    const state=(await client.query('SELECT current_database() database,current_setting(\'data_directory\') directory')).rows[0];
    if(state.database!==database||realpathSync(state.directory).toLowerCase()!==realpathSync(marker.data).toLowerCase()){await client.end();throw new Error('Exact owned restore target verification failed');}
    return client;
  };
  try{
    control=await connect('postgres');
    if((await control.query('SELECT 1 FROM pg_database WHERE datname=$1',[target])).rowCount)throw new Error('Restore target already exists; refusing reuse');
    await control.query('CREATE DATABASE '+quote(target)+' OWNER postgres TEMPLATE template0 ENCODING \'UTF8\'');created=true;
    // Keep the recovered copy private before any restored data reaches disk.
    await control.query('REVOKE ALL ON DATABASE '+quote(target)+' FROM PUBLIC,orion_crm_app');
    await control.end();control=null;
    stage='archive_restore';
    try{execFileSync(program,['--host=127.0.0.1','--port=55432','--username=postgres','--dbname='+target,'--no-owner','--single-transaction','--exit-on-error',backup],{windowsHide:true,env,stdio:'ignore',timeout:60000});}catch{throw new Error('Isolated archive restore failed; private target retained for inspection');}
    restored=await connect(target);
    stage='private_access';
    await restored.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const privateAccess=(await restored.query("SELECT has_database_privilege('orion_crm_app',current_database(),'CONNECT') app_connect,EXISTS(SELECT 1 FROM pg_database d,LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database() AND a.grantee=0 AND a.privilege_type='CONNECT') public_connect")).rows[0];
    if(privateAccess.app_connect||privateAccess.public_connect)throw new Error('Recovered database is not private');
    stage='row_counts';
    const tables=[];
    for(const entry of expected){
      const count=Number((await restored.query('SELECT count(*)::bigint n FROM '+quote(entry.schema)+'.'+quote(entry.table))).rows[0].n);
      if(count!==entry.rows)throw new Error('Restored row counts differ from archive');
      tables.push({...entry,rows:count});
    }
    stage='foreign_keys';
    const foreignKeys=(await restored.query(`SELECT c.convalidated,c.confmatchtype,ns.nspname child_schema,child.relname child_table,np.nspname parent_schema,parent.relname parent_table,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(num,pos) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.pos) child_columns,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(num,pos) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num ORDER BY k.pos) parent_columns
      FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=child.relnamespace
      JOIN pg_class parent ON parent.oid=c.confrelid JOIN pg_namespace np ON np.oid=parent.relnamespace
      WHERE c.contype='f' AND ns.nspname=ANY($1::text[]) ORDER BY ns.nspname,child.relname,c.conname`,[[...schemas]])).rows;
    for(const key of foreignKeys){
      if(!key.convalidated||!schemas.has(key.parent_schema)||!['s','f'].includes(key.confmatchtype))throw new Error('Unvalidated or unsupported restored foreign key');
      const allSet=key.child_columns.map(column=>'c.'+quote(column)+' IS NOT NULL').join(' AND ');
      const anySet=key.child_columns.map(column=>'c.'+quote(column)+' IS NOT NULL').join(' OR ');
      const equal=key.child_columns.map((column,index)=>'p.'+quote(key.parent_columns[index])+'=c.'+quote(column)).join(' AND ');
      const orphan='('+allSet+') AND NOT EXISTS(SELECT 1 FROM '+quote(key.parent_schema)+'.'+quote(key.parent_table)+' p WHERE '+equal+')';
      const partial=key.confmatchtype==='f'?' OR (('+anySet+') AND NOT ('+allSet+'))':'';
      if((await restored.query('SELECT 1 FROM '+quote(key.child_schema)+'.'+quote(key.child_table)+' c WHERE ('+orphan+')'+partial+' LIMIT 1')).rowCount)throw new Error('Restored foreign key relationship failed');
    }
    stage='report';
    const migrations=(await restored.query('SELECT name,checksum FROM public.orion_clinical_migrations ORDER BY name')).rows;
    const directoryRuntime=(await restored.query("SELECT to_regclass('orion_directory.runtime') present")).rows[0].present
      ?(await restored.query('SELECT source,revision,import_complete FROM orion_directory.runtime WHERE id=1')).rows[0]:null;
    const accountCount=tables.find(table=>table.schema==='orion_directory'&&table.table==='accounts')?.rows??null;
    const patientCount=tables.find(table=>table.schema==='orion_crm'&&table.table==='patients')?.rows??null;
    await restored.query('ROLLBACK');
    const directory=join(runtime,'restore-drills');mkdirSync(directory,{recursive:true});
    const reportPath=join(directory,target+'.json');
    const report={version:1,result:'passed',checkedAt:new Date().toISOString(),database:target,backup,sha256:digest,liveDatabaseTouched:false,privateAccess,tables,foreignKeysChecked:foreignKeys.length,migrations,directoryRuntime,accountCount,patientCount};
    writeFileSync(reportPath,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
    console.log(JSON.stringify({result:'passed',database:target,reportPath,backupSha256:digest,tables:tables.length,rows:tables.reduce((sum,table)=>sum+table.rows,0),foreignKeysChecked:foreignKeys.length,migrations:migrations.map(row=>row.name),directoryRuntime,accountCount,patientCount,liveDatabaseTouched:false,copyRetained:true}));
  }catch(error){
    // Only this generated name may be returned. Driver/archive errors can
    // include SQL or clinical material, so no error object is ever printed.
    console.error(JSON.stringify({result:'failed',stage,database:created?target:null,copyRetained:created,liveDatabaseTouched:false}));
    throw error;
  }finally{await restored?.end().catch(()=>undefined);await control?.end().catch(()=>undefined);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Restore drill could not complete; no clinical text or credentials printed.');process.exitCode=1;});
