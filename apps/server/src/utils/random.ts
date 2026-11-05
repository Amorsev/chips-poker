import { randomInt } from 'node:crypto';

/** Crypto-strength integer in [0, max). Used by the dealing engine. */
export function secureRandomInt(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error('secureRandomInt requires a positive integer');
  }
  return randomInt(maxExclusive);
}
