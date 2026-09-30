/** Stable staff login key. Passwords are never normalized by this policy. */
export function normalizeStaffLogin(value: unknown): string | null {
  // Check BEFORE case-folding: Unicode Kelvin sign otherwise aliases ASCII k.
  // Only ordinary surrounding ASCII spaces are accepted, not invisible controls.
  if (typeof value !== 'string' || value.length > 256 || /[^\x20-\x7e]/.test(value)) return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._@+-]{2,127}$/.test(normalized) ? normalized : null;
}

export const STAFF_PASSWORD_MAX_BYTES = 1024;

export function isStaffPasswordInput(value: unknown): value is string {
  if (typeof value !== 'string' || !value.length || value.length > STAFF_PASSWORD_MAX_BYTES) return false;
  // TextEncoder replaces isolated surrogates; accepting them would alias passwords.
  if (Array.from(value).some(char => {
    const point = char.codePointAt(0)!;
    return point >= 0xd800 && point <= 0xdfff;
  })) return false;
  return new TextEncoder().encode(value).byteLength <= STAFF_PASSWORD_MAX_BYTES;
}
