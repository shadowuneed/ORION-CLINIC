import { expect, it } from 'vitest';
import { homeLandingPath } from './home-landing';
const none = { clinician:false, pathway:false, scheduling:false, patientDirectory:false };

it('opens only a tool actually available to the signed-in staff member',()=>{
  expect(homeLandingPath(none,{})).toBe('/access');
  expect(homeLandingPath({...none,patientDirectory:true},{})).toBe('/patients');
  expect(homeLandingPath({...none,patientDirectory:true,scheduling:true},{})).toBe('/scheduling');
  expect(homeLandingPath({...none,patientDirectory:true,scheduling:true,pathway:true},{})).toBe('/pathway');
  expect(homeLandingPath({...none,clinician:true},{})).toBeNull();
});
it('preserves the selected scope and duplicate selectors for destination validation',()=>{
  expect(homeLandingPath({...none,pathway:true},{facilityId:'facility-a',accessAssignmentId:'assignment-a'}))
    .toBe('/pathway?accessAssignmentId=assignment-a&facilityId=facility-a');
  expect(homeLandingPath({...none,scheduling:true},{accessAssignmentId:['first','second'],facilityId:'facility-b'}))
    .toBe('/scheduling?accessAssignmentId=first&accessAssignmentId=second&facilityId=facility-b');
});
it.each(['encounter-a','',['encounter-a','encounter-b']])('never redirects an explicit encounter selector %j',encounterId=>{
  expect(homeLandingPath({...none,pathway:true},{encounterId})).toBeNull();
});
