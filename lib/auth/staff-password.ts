import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { isStaffPasswordInput } from './staff-login-policy';

if (typeof window !== 'undefined') throw new Error('Staff passwords require server execution');

// Fixed, versioned OWASP scrypt profile. No parameters supplied by a request/DB
// can increase memory or weaken work. Node-tested; Workers CPU/load acceptance is
// still a deployment gate, not inferred from node:crypto API compatibility.
const prefix = 'orion$scrypt$v1$32768$8$3$';
const hashPattern = /^orion\$scrypt\$v1\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{64})$/;
const dummyHash = `${prefix}${'0'.repeat(32)}$${'0'.repeat(64)}`;
const toHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
let activeDerivations = 0;

export function isStaffPasswordHash(value: unknown): value is string {
  return typeof value === 'string' && value.length === 123 && hashPattern.test(value);
}

async function derive(password: string, salt: Uint8Array): Promise<Buffer> {
  // A process memory ceiling, NOT a substitute for durable login throttling or
  // deployment-wide abuse controls. No unbounded queue of plaintext passwords.
  if (activeDerivations >= 2) throw new Error('Password verification unavailable');
  activeDerivations += 1;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, result) => {
        if (error) reject(new Error('Password verification unavailable'));
        else resolve(result);
      });
    });
  } finally {
    activeDerivations -= 1;
  }
}

/** Trusted provisioning/reset only; never an open registration endpoint. */
export async function hashStaffPassword(password: string): Promise<string> {
  if (!isStaffPasswordInput(password) || Array.from(password).length < 15) {
    throw new TypeError('Password must contain at least 15 characters and at most 1024 UTF-8 bytes');
  }
  const salt = randomBytes(16);
  const digest = await derive(password, salt);
  try {
    return `${prefix}${toHex(salt)}$${toHex(digest)}`;
  } finally {
    digest.fill(0);
  }
}

/** null = unknown/disabled account: do the same-cost KDF, always return false. */
export async function verifyStaffPassword(password: string, encoded: string | null): Promise<boolean> {
  if (!isStaffPasswordInput(password)) throw new TypeError('Invalid password input');
  const valid = isStaffPasswordHash(encoded);
  const match = hashPattern.exec(valid ? encoded : dummyHash)!;
  const expected = Buffer.from(match[2], 'hex');
  const actual = await derive(password, Buffer.from(match[1], 'hex'));
  try {
    const equal = timingSafeEqual(actual, expected);
    if (encoded !== null && !valid) throw new Error('Password verification unavailable');
    return encoded !== null && valid && equal;
  } finally {
    actual.fill(0);
    expected.fill(0);
  }
}
