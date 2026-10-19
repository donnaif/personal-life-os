import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEYLEN = 64;

/** Hash a password with scrypt. Format: scrypt$<saltHex>$<hashHex>. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/** Constant-time password verification. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'hex');
  const expected = Buffer.from(parts[2]!, 'hex');
  const derived = await scrypt(password, salt, expected.length || KEYLEN);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** Hash an opaque refresh token for at-rest storage (never store the raw token). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newOpaqueToken(): string {
  return randomBytes(48).toString('base64url');
}
