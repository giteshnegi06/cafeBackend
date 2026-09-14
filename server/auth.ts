/**
 * Password hashing for staff accounts, using Node's built-in crypto —
 * scrypt is deliberately slow/memory-hard to brute-force, so no extra
 * dependency (bcrypt etc.) is needed for a single-cafe staff list.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${hash}`;
}

// Password-reset tokens. The raw token goes into the emailed link; only its
// SHA-256 hash is stored, so a leaked database row can't reset anything.
export function generateResetToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, 'hex');
  const candidate = scryptSync(password, salt, KEY_LENGTH);
  // Buffers must be equal length for timingSafeEqual, or it throws.
  if (candidate.length !== hashBuffer.length) return false;
  return timingSafeEqual(candidate, hashBuffer);
}
