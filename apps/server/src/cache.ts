import { getRedis } from './redis.js';
import { logger } from './logger.js';

const memory = new Map<string, { expiresAt: number; value: string }>();

/**
 * Small cache façade: Redis when available, process memory otherwise.
 * Values are JSON and short-lived (leaderboards/lobby). Authoritative game
 * state never lives only in this cache.
 */
export async function cached<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  if (redis) {
    try {
      const hit = await redis.get(key);
      if (hit) return JSON.parse(hit) as T;
      const value = await loader();
      await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      return value;
    } catch (error) {
      logger.warn({ err: error, key }, 'Redis cache read/write failed');
    }
  }

  const local = memory.get(key);
  if (local && local.expiresAt > Date.now()) {
    return JSON.parse(local.value) as T;
  }

  const value = await loader();
  memory.set(key, { value: JSON.stringify(value), expiresAt: Date.now() + ttlSeconds * 1_000 });
  // Opportunistic cleanup keeps the fallback map bounded.
  if (memory.size > 500) {
    const now = Date.now();
    for (const [candidate, entry] of memory) {
      if (entry.expiresAt <= now) memory.delete(candidate);
    }
  }
  return value;
}

export async function invalidateCache(prefix: string): Promise<void> {
  for (const key of memory.keys()) {
    if (key.startsWith(prefix)) memory.delete(key);
  }
  const redis = getRedis();
  if (!redis) return;
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  } catch (error) {
    logger.warn({ err: error }, 'Cache invalidation failed');
  }
}
