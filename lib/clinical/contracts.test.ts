import { describe,it,expect } from 'vitest';
import { clinicalCommandSchema,clinicalInternalCommandSchema } from './contracts';
const idempotencyKey='81658720-bbbe-47b7-ab02-6b80a70c5701';
describe('clinical command trust boundary',()=>{
  it('allows one-click start and rejects client identity claims',()=>{
    expect(clinicalCommandSchema.parse({type:'encounter.start',patientId:'patient-1',idempotencyKey}).type).toBe('encounter.start');
    expect(clinicalCommandSchema.parse({type:'encounter.start',patientId:'patient-1',visitId:'visit-2',idempotencyKey})).toMatchObject({visitId:'visit-2'});
    for(const visitId of [null,'',12]) expect(clinicalCommandSchema.safeParse({type:'encounter.start',patientId:'patient-1',visitId,idempotencyKey}).success).toBe(false);
    expect(clinicalCommandSchema.safeParse({type:'encounter.start',patientId:'patient-1',idempotencyKey,issuer:'spoof'}).success).toBe(false);
  });
  it('requires explicit human review and exact optimistic version',()=>{
    const publish={type:'note.publish',encounterId:'encounter-1',noteId:'note-1',expectedVersion:2,idempotencyKey,reviewAcknowledged:true};
    expect(clinicalCommandSchema.safeParse(publish).success).toBe(true);
    for(const value of [false,null,undefined]) expect(clinicalCommandSchema.safeParse({...publish,reviewAcknowledged:value}).success).toBe(false);
    for(const value of [0,null,'2',1.1]) expect(clinicalCommandSchema.safeParse({...publish,expectedVersion:value}).success).toBe(false);
  });
  it('does not let a browser impersonate a speech provider',()=>{
    const speech={type:'transcript.append',encounterId:'encounter-1',sessionId:idempotencyKey,utteranceIndex:0,inputHash:'a'.repeat(64),text:'Speech',role:'unknown',language:'ru',startedAtMs:0,endedAtMs:100,idempotencyKey};
    expect(clinicalInternalCommandSchema.safeParse(speech).success).toBe(true);
    expect(clinicalCommandSchema.safeParse(speech).success).toBe(false);
    expect(clinicalInternalCommandSchema.safeParse({...speech,endedAtMs:-1}).success).toBe(false);
  });
});
