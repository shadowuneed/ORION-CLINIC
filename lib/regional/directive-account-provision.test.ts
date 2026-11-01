import { describe, expect, it } from 'vitest';
// Exercise the exact planner used by the local provisioning command.
import { directiveCredentialPlan } from '../../scripts/configure-directive-accounts.mjs';

const issuer = 'orion:local:directives';
function staff() {
  return ['directive-admin', ...Array.from({ length: 36 }, (_, i) => `head-facility-${i + 1}`)].map(id => ({ id, issuer, subject: id, name: id }));
}
describe('dedicated directive credential plan', () => {
  it('plans only the separate 37 accounts and leaves existing unrelated identities alone', () => {
    const plan = directiveCredentialPlan([...staff(), { id: 'user-a', issuer: 'local', subject: 'user-a', name: 'existing' }], [{ user_id: 'user-a', issuer: 'local', subject: 'user-a', login: 'user-a' }]);
    expect(plan).toHaveLength(37); expect(plan.every((item: { create: boolean }) => item.create)).toBe(true);
  });
  it('resumes without replacing an existing dedicated credential', () => {
    const plan = directiveCredentialPlan(staff(), [{ user_id: 'directive-admin', issuer, subject: 'directive-admin', login: 'directive-admin' }]);
    expect(plan.find((item: { person: { id: string } }) => item.person.id === 'directive-admin').create).toBe(false);
  });
  it.each(['id', 'subject', 'issuer', 'login'])('rejects a conflicting existing %s', field => {
    const row = { user_id: 'directive-admin', issuer, subject: 'directive-admin', login: 'directive-admin' };
    if (field === 'id') row.user_id = 'someone-else'; else row[field as 'subject' | 'issuer' | 'login'] = 'someone-else';
    expect(() => directiveCredentialPlan(staff(), [row])).toThrow('conflict');
  });
  it('fails closed on partial or expanded identity sets', () => {
    expect(() => directiveCredentialPlan(staff().slice(1), [])).toThrow();
    expect(() => directiveCredentialPlan([...staff(), { id: 'head-extra', issuer, subject: 'head-extra' }], [])).toThrow();
  });
  it('rejects duplicate or mismatched principals', () => {
    const people = staff(); people[1] = people[0];
    expect(() => directiveCredentialPlan(people, [])).toThrow();
    const wrong = staff(); wrong[1].subject = 'user-a';
    expect(() => directiveCredentialPlan(wrong, [])).toThrow();
  });
});
