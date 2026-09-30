import assert from 'node:assert/strict';
import { verifiedWorkflows } from '../docs/user-guide/verified-workflows.mjs';
const port = Number(process.argv[2] ?? 3213);
assert(Number.isInteger(port) && port >= 3213 && port <= 3299, 'Isolated test port required');
const origin = `http://127.0.0.1:${port}`;
for (const [persona, expected] of [['doctor', 200], ['nurse', 200], ['administrator', 403], ['registrar', 403]]) {
  const login = await fetch(`${origin}/__test/select?persona=${persona}`, { method: 'POST', headers: { origin }, redirect: 'manual' });
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert(cookie, 'Missing isolated session');
  const actorAssignmentId = `persona-${persona}-assignment`;
  const worklistUrl = `${origin}/api/workspace?view=worklist&facilityId=fac-a&accessAssignmentId=${actorAssignmentId}`;
  const worklist = await fetch(worklistUrl, { headers: { cookie } });
  assert.equal(worklist.status, persona === 'doctor' ? 200 : 403, `${persona} worklist status`);
  const worklistData = await worklist.json();
  if (persona === 'doctor') {
    assert(Array.isArray(worklistData.encounters), 'Missing persisted worklist');
    assert.equal(worklistData.clinicalSections, undefined, 'Worklist exposed clinical sections');
    assert.equal(worklistData.transcript, undefined, 'Worklist exposed transcript');
  } else {
    assert.equal(worklistData.encounters, undefined, 'Denied worklist exposed patients');
  }
  console.log(`${persona}: scoped worklist PASS`);
  const adminUrl = `${origin}/api/access/admin?facilityId=fac-a&actorAssignmentId=${actorAssignmentId}`;
  const administration = await fetch(adminUrl, { headers: { cookie } });
  assert.equal(administration.status, persona === 'administrator' ? 200 : 403, `${persona} administration status`);
  const administrationData = await administration.json();
  if (persona === 'administrator') {
    assert.equal(administrationData.actorAssignmentId, actorAssignmentId);
    assert.equal(administrationData.persistence, 'd1');
    assert(administrationData.workspace.assignments.some((item) => item.id === actorAssignmentId));
    const reloaded = await fetch(adminUrl, { headers: { cookie } });
    assert.equal(reloaded.status, 200);
    assert.deepEqual((await reloaded.json()).workspace, administrationData.workspace, 'Admin reload changed workspace');
  } else {
    assert.equal(administrationData.error.code, 'ACCESS_ADMINISTRATION_FORBIDDEN');
    assert.equal(administrationData.workspace, undefined, 'Denied response leaked workspace');
    const deniedGrant = await fetch(`${origin}/api/access/admin/assignments`, {
      method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ facilityId: 'fac-a', actorAssignmentId,
        departmentId: 'permission-probe-no-department', membershipId: 'permission-probe-no-member',
        roles: ['nurse'], allowPermissions: [], denyPermissions: [],
        effectiveFrom: 1704067200000, effectiveUntil: null,
        changeReason: 'Isolated role denial probe', idempotencyKey: crypto.randomUUID() }),
    });
    assert.equal(deniedGrant.status, 403, `${persona} grant must fail before target lookup`);
    assert.equal((await deniedGrant.json()).error.code, 'ACCESS_ADMINISTRATION_FORBIDDEN');
  }
  const wrongScope = await fetch(`${origin}/api/access/admin?facilityId=permission-probe-no-facility&actorAssignmentId=${actorAssignmentId}`, { headers: { cookie } });
  assert.equal(wrongScope.status, 403, `${persona} wrong facility must fail closed`);
  console.log(`${persona}: access administration/read/reload or grant denial PASS`);
  const help = await fetch(`${origin}/help`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(help.status, 200, `${persona} help status`);
  const helpHtml = await help.text();
  for (const flow of verifiedWorkflows) {
    assert(helpHtml.includes(flow.title), `${persona} missing help workflow: ${flow.title}`);
  }
  assert(helpHtml.includes('/user-guide.html'), `${persona} missing handbook link`);
  console.log(`${persona}: help workflows PASS (HTTP, not visual acceptance)`);
  const response = await fetch(`${origin}/api/care`, { headers: { cookie } });
  assert.equal(response.status, expected, `${persona} care status`);
  const data = await response.json();
  const schedule = await fetch(`${origin}/api/scheduling`, { headers: { cookie } });
  const scheduleStatus = persona === 'doctor' || persona === 'registrar' ? 200 : 403;
  assert.equal(schedule.status, scheduleStatus, `${persona} scheduling status`);
  if (scheduleStatus === 200) {
    assert.equal((await schedule.json()).viewer.role, persona === 'doctor' ? 'clinician' : 'registrar');
  }
  console.log(`${persona}: scheduling=${scheduleStatus} PASS`);
  if (expected === 200) {
    assert.equal(data.role, persona === 'doctor' ? 'clinician' : 'nurse');
    assert.equal(data.capabilities['plan.sign'], persona === 'doctor');
    assert.equal(data.capabilities['task.response'], persona === 'nurse');
  }
  if (persona === 'nurse') {
    const denied = await fetch(`${origin}/api/care/plans`, {
      method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        facilityId: 'fac-a', accessAssignmentId: 'persona-nurse-assignment',
        enrollmentId: 'permission-probe-no-enrollment', expectedEnrollmentVersion: 1,
        expectedPlanVersion: null, doctorConfirmed: true, localSourceAcknowledged: true,
        reason: 'Isolated permission denial test', idempotencyKey: crypto.randomUUID(),
        content: { effectiveFrom: '2026-09-15', effectiveTo: '2026-10-15',
          goals: ['Artificial permission probe'], treatmentPlan: 'Not a medical plan',
          dietPlan: 'Not a medical plan', medications: [],
          tasks: [{ key: 'followup', kind: 'follow_up_visit', title: 'Artificial test',
            dueDate: '2026-10-01', ownerRole: 'clinician',
            assignedMembershipId: 'persona-doctor-member', instructions: null }] },
      }),
    });
    assert.equal(denied.status, 403, 'Nurse plan POST must be forbidden');
    assert.equal((await denied.json()).error.code, 'CHRONIC_CARE_FORBIDDEN');
    console.log('nurse: actual plan POST with doctorConfirmed=true -> role denial 403 PASS');
  }
  const signout = await fetch(`${origin}/signout-with-chatgpt`, { method: 'POST', headers: { origin, cookie }, redirect: 'manual' });
  assert.equal(signout.status, 303);
  assert.equal((await fetch(`${origin}/api/care`, { headers: { cookie } })).status, 401, 'Session must be invalid after logout');
  assert.equal((await fetch(adminUrl, { headers: { cookie } })).status, 401, 'Admin API must reject logged-out session');
  assert.equal((await fetch(worklistUrl, { headers: { cookie } })).status, 401, 'Worklist must reject logged-out session');
  console.log(`${persona}: care=${expected}; signout -> 401 PASS`);
}
