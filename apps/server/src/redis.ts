import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server } from 'socket.io';
import { config } from './config.js';
import { logger } from './logger.js';

let commandClient: Redis | null = null;
let subscriber: Redis | null = null;
let lastConnectError: string | undefined;

export function getRedis(): Redis | null {
  return commandClient;
}

export async function initRedis(io: Server): Promise<void> {
  if (!config.REDIS_URL) {
    logger.info('REDIS_URL is not set; using the in-memory Socket.IO adapter');
    return;
  }

  lastConnectError = undefined;
  try {
    commandClient = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: true,
      // Fail fast at boot instead of reconnecting forever when Redis is absent.
      retryStrategy: () => null
    });
    // Without an 'error' listener ioredis prints "[ioredis] Unhandled error event".
    attachErrorLogging(commandClient, 'command');
    await commandClient.connect();

    // Socket.IO needs dedicated pub/sub connections. The adapter distributes
    // events between game nodes; table ownership is documented in ARCHITECTURE.md.
    const pubClient = commandClient;
    subscriber = commandClient.duplicate();
    attachErrorLogging(subscriber, 'subscriber');
    await subscriber.connect();

    // Once connected, reconnect with backoff if Redis restarts later.
    const reconnect = (times: number) => Math.min(times * 200, 5_000);
    commandClient.options.retryStrategy = reconnect;
    subscriber.options.retryStrategy = reconnect;

    io.adapter(createAdapter(pubClient, subscriber));
    logger.info('Redis connected; Socket.IO Redis adapter enabled');
  } catch (error) {
    logger.warn(
      { redisUrl: redactUrl(config.REDIS_URL), reason: lastConnectError ?? describeError(error) },
      'Redis unavailable; continuing with in-memory adapter/cache'
    );
    await closeRedis();
  }
}

function attachErrorLogging(client: Redis, role: string): void {
  let lastCode: string | undefined;
  client.on('error', (error: unknown) => {
    const reason = describeError(error);
    lastConnectError = reason;
    // Log each distinct failure once instead of on every reconnect attempt.
    if (reason === lastCode) return;
    lastCode = reason;
    logger.debug({ role, reason }, 'Redis connection error');
  });
  client.on('ready', () => {
    lastCode = undefined;
  });
}

function describeError(error: unknown): string {
  if (error instanceof AggregateError) {
    return error.errors.map((inner) => describeError(inner)).join('; ');
  }
  if (error && typeof error === 'object') {
    const { code, address, port, message } = error as {
      code?: string;
      address?: string;
      port?: number;
      message?: string;
    };
    if (code) return address ? `${code} ${address}:${port ?? ''}` : code;
    if (message) return message;
  }
  return String(error);
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '<invalid REDIS_URL>';
  }
}

export async function closeRedis(): Promise<void> {
  const clients = [subscriber, commandClient].filter((client): client is Redis => Boolean(client));
  commandClient = null;
  subscriber = null;
  await Promise.allSettled(clients.map((client) => client.quit()));
}
