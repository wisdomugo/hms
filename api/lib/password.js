import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/*
 * Copied from SiteSilo unchanged. Nothing in here is CMS-specific, and it is
 * already at the standard a hospital needs.
 */

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [salt, hashHex] = String(stored).split(':');
  if (!salt || !hashHex) return false;

  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(hashHex, 'hex');

  // Constant-time comparison. A plain === exits early on the first differing
  // byte, so response time leaks how much of the hash matched.
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
