import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/** Cryptographically secure random hex string. */
export function randomHex(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/** Hash opaque tokens before storing them, so a DB leak cannot reset accounts. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Include a server secret (pepper) so IP hashes cannot be reversed by brute force. */
export function hashIp(ip: string): string {
  return createHash('sha256').update(`${config.DEVICE_COOKIE_SECRET}:${ip}`).digest('hex');
}

/** Constant-time comparison for short secrets. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function newId(): string {
  return randomUUID();
}
