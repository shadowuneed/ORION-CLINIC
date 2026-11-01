import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ClinicalCommand, ClinicalSnapshot } from '@/lib/clinical/contracts';
import { encounterFixture } from '@/lib/clinical/test-fixtures';
import { ReferralsPanel, commitReferralAction, confirmedReferralAction, referralGroups } from './referrals-panel';

const command: ClinicalCommand = { type: 'referral.decline', referralId: 'referral-1', expectedVersion: 2, reason: 'Причина врача', idempotencyKey: '4652da2e-f0b4-4f4b-96ae-796e7c19ec14' };
function fixture(): ClinicalSnapshot {
  const data = encounterFixture();
  const base = { patientId: 'patient-1', encounterId: 'encounter-1', sourcePractitionerId: 'doctor-2', recipientPractitionerId: 'doctor-1', noteId: 'note-1',
    reason: 'Подтверждённое направление', version: 2, resultingEncounterId: null, createdAt: data.generatedAt, updatedAt: data.generatedAt };
  data.referrals = [{ ...base, id: 'routine', priority: 'routine', status: 'pending' }, { ...base, id: 'urgent', priority: 'urgent', status: 'pending' },
    { ...base, id: 'outgoing', sourcePractitionerId: 'doctor-1', recipientPractitionerId: 'doctor-2', priority: 'routine', status: 'pending' },
    { ...base, id: 'history', priority: 'urgent', status: 'accepted', resultingEncounterId: 'consultation-2' },
    { ...base, id: 'foreign', sourcePractitionerId: 'doctor-3', recipientPractitionerId: 'doctor-4', priority: 'urgent', status: 'pending' }];
  return data;
}
describe('referral decision confirmation and priority groups', () => {
  it('keeps the form/reason when parent reports failure or rejects', async () => {
    const closeAndClear = vi.fn(); const rejected = vi.fn().mockResolvedValue(false);
    expect(await commitReferralAction(command, rejected, closeAndClear)).toBe(false); expect(closeAndClear).not.toHaveBeenCalled();
    await expect(commitReferralAction(command, vi.fn().mockRejectedValue(new Error('Network failed')), closeAndClear)).rejects.toThrow('Network failed');
    expect(closeAndClear).not.toHaveBeenCalled(); expect(rejected).toHaveBeenCalledWith(command);
  });
  it('clears only on explicit durable confirmation', async () => {
    const closeAndClear = vi.fn(); expect(await commitReferralAction(command, vi.fn().mockResolvedValue(true), closeAndClear)).toBe(true);
    expect(closeAndClear).toHaveBeenCalledOnce();
  });
  it('global retry closes only the matching action/version, never another clinician draft', () => {
    const action = { id: 'referral-1', type: 'referral.decline' as const, version: 2 };
    expect(confirmedReferralAction(action, command)).toBe(true);
    expect(confirmedReferralAction(action, { ...command, referralId: 'referral-2' })).toBe(false);
    expect(confirmedReferralAction(action, { ...command, expectedVersion: 3 })).toBe(false);
    expect(confirmedReferralAction(action, { ...command, type: 'referral.revoke' })).toBe(false);
  });
  it('separates urgent incoming, routine, outgoing and history without exposing unrelated referrals', () => {
    const groups = referralGroups(fixture()); expect(groups.map(group => group.id)).toEqual(['urgent', 'routine', 'outgoing', 'history']);
    expect(groups.flatMap(group => group.items.map(item => item.id))).toEqual(['urgent', 'routine', 'outgoing', 'history']);
  });
  it('SSR makes priority and follow-up consultation explicit, without submitting changes', () => {
    const onCommand = vi.fn(); const html = renderToStaticMarkup(createElement(ReferralsPanel, { snapshot: fixture(), blocked: true, onCommand }));
    expect(html).toContain('Входящие: срочные'); expect(html).toContain('Исходящие: ожидают ответа');
    expect(html).toContain('Открыть консультацию'); expect(html).toContain('consultation-2'); expect(html).toContain('disabled=""');
    expect(html).not.toContain('Учебная жалоба'); expect(onCommand).not.toHaveBeenCalled();
  });
});
