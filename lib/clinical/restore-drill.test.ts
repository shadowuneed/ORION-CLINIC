import {describe,it,expect} from 'vitest';
import {assertDrillDatabase,archiveCopyCounts} from '../../scripts/clinical-restore-drill.mjs';
describe('isolated restore drill safety boundaries',()=>{
  it('rejects live/system/reused arbitrary database targets',()=>{
    for(const name of ['orion_crm_local','postgres','template0','orion_restore_drill_',null,'orion_restore_drill_a; DROP DATABASE x'])expect(()=>assertDrillDatabase(name)).toThrow();
    expect(()=>assertDrillDatabase('orion_restore_drill_'+'a'.repeat(32))).not.toThrow();
  });
  it('counts archived COPY rows without returning clinical values',()=>{
    const counts=archiveCopyCounts('COPY orion_crm.patients (id, name) FROM stdin;\np1\tName one\np2\tEscaped\\nline\n\\.\nCOPY public.orion_clinical_migrations (name) FROM stdin;\n\\.\n');
    expect(counts).toEqual([{schema:'orion_crm',table:'patients',rows:2},{schema:'public',table:'orion_clinical_migrations',rows:0}]);
  });
  it('rejects unexpected schemas, truncated archives and duplicate COPY tables',()=>{
    for(const sql of ['COPY other.patient (id) FROM stdin;\n\\.','COPY orion_crm.patients (id) FROM stdin;\n1','COPY orion_crm.patients (id) FROM stdin;\n\\.\nCOPY orion_crm.patients (id) FROM stdin;\n\\.'])expect(()=>archiveCopyCounts(sql)).toThrow();
  });
});
