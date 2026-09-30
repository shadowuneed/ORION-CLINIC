import { describe, expect, it, vi } from 'vitest';
import { isStaffPasswordInput, normalizeStaffLogin } from './staff-login-policy';
import { hashStaffPassword, isStaffPasswordHash, verifyStaffPassword } from './staff-password';

describe('staff credential input policy', () => {
  it('normalizes only staff login, not password', () => {
    expect(normalizeStaffLogin('  Doctor.A+clinic@EXAMPLE.TEST  ')).toBe('doctor.a+clinic@example.test');
    expect(normalizeStaffLogin('a'.repeat(128))).toBe('a'.repeat(128));
    expect(isStaffPasswordInput('  fifteen spaces are significant  ')).toBe(true);
  });
  it.each([null, 1, '', 'ab', 'a'.repeat(129), '_doctor', 'do ctor', 'врач', 'dоctor', 'x/y', 'x\\y', 'abc\u0000', 'Klinic', '\u00a0doctor', 'doctor\n'])('rejects ambiguous login %j', value => {
    expect(normalizeStaffLogin(value)).toBeNull();
  });
  it.each([null, 1, '', '\ud800', 'secret\udfff', 'a'.repeat(1025), 'я'.repeat(513), '🧪'.repeat(257)])('bounds password without lossy Unicode conversion %j', value => {
    expect(isStaffPasswordInput(value)).toBe(false);
  });
  it('accepts exact UTF-8 byte boundary and valid astral characters', () => {
    expect(isStaffPasswordInput('я'.repeat(512))).toBe(true);
    expect(isStaffPasswordInput('🧪'.repeat(256))).toBe(true);
  });
});

describe('fixed-cost individual staff passwords', () => {
  it('creates independently salted records and verifies exact passwords', async () => {
    const password = 'Только искусственный пароль 🧪';
    const first = await hashStaffPassword(password);
    const second = await hashStaffPassword(password);
    expect(first).toHaveLength(123);
    expect(isStaffPasswordHash(first)).toBe(true);
    expect(second).not.toBe(first);
    expect(first).not.toContain(password);
    expect(await verifyStaffPassword(password, first)).toBe(true);
    expect(await verifyStaffPassword(password, second)).toBe(true);
    expect(await verifyStaffPassword(`${password} `, first)).toBe(false);
    expect(await verifyStaffPassword('wrong', first)).toBe(false);
  });
  it('does not trim or Unicode-normalize passwords', async () => {
    const password = '  a synthetic e\u0301 password  ';
    const encoded = await hashStaffPassword(password);
    expect(await verifyStaffPassword(password, encoded)).toBe(true);
    expect(await verifyStaffPassword(password.trim(), encoded)).toBe(false);
    expect(await verifyStaffPassword(password.normalize('NFC'), encoded)).toBe(false);
  });
  it('hashes and verifies the maximum UTF-8 length without truncating', async () => {
    const password = '🧪'.repeat(256);
    const encoded = await hashStaffPassword(password);
    expect(await verifyStaffPassword(password, encoded)).toBe(true);
    expect(await verifyStaffPassword(password.slice(0, -2), encoded)).toBe(false);
  });
  it.each(['short', 'a'.repeat(14), '🧪'.repeat(14), '\ud800'.repeat(15), 'x'.repeat(1025)])('rejects invalid provisioning password', async value => {
    await expect(hashStaffPassword(value)).rejects.toThrow('Password must contain');
  });
  it('does real work for unknown/disabled identity but never accepts it', async () => {
    expect(await verifyStaffPassword('synthetic password', null)).toBe(false);
  });
  it('bounds in-process memory without queueing unbounded plaintext requests', async () => {
    const first = verifyStaffPassword('synthetic password one', null);
    const second = verifyStaffPassword('synthetic password two', null);
    await expect(verifyStaffPassword('synthetic password three', null)).rejects.toThrow('Password verification unavailable');
    expect(await Promise.all([first, second])).toEqual([false, false]);
    expect(await verifyStaffPassword('synthetic password after completion', null)).toBe(false);
  });
  const validShape = `orion$scrypt$v1$32768$8$3$${'a'.repeat(32)}$${'b'.repeat(64)}`;
  it.each([
    '', validShape + '\n', validShape + '$extra', validShape.toUpperCase(),
    validShape.replace('$32768$', '$16384$'), validShape.replace('$32768$', '$1073741824$'),
    validShape.replace('$3$', '$1$'), validShape.replace('$v1$', '$v2$'),
    validShape.replace('a'.repeat(32), 'a'.repeat(31)), validShape.replace('b'.repeat(64), 'z'.repeat(64)),
  ])('rejects corrupt/unsupported hashes after bounded dummy derivation', async encoded => {
    expect(isStaffPasswordHash(encoded)).toBe(false);
    await expect(verifyStaffPassword('synthetic password', encoded)).rejects.toThrow('Password verification unavailable');
  });
  it('rejects accidental browser use', async () => {
    vi.resetModules();
    vi.stubGlobal('window', {});
    try { await expect(import('./staff-password')).rejects.toThrow('Staff passwords require server execution'); }
    finally { vi.unstubAllGlobals(); vi.resetModules(); }
  });
});
