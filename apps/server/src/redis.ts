import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server } from 'socket.io';
import { config } from './config.js';
import { logger } from './logger.js';

let commandClient: Redis | null = null;
let subscriber: Redis | null = null;

export function getRedis(): Redis | null {
  return commandClient;
}

export async function initRedis(io: Server): Promise<void> {
  if (!config.REDIS_URL) {
    logger.info('REDIS_URL is not set; using the in-memory Socket.IO adapter');
    return;
  }

  try {
    commandClient = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: true
    });
    await commandClient.connect();

    // Socket.IO needs dedicated pub/sub connections. The adapter distributes
    // events between game nodes; table ownership is documented in ARCHITECTURE.md.
    const pubClient = commandClient;
    subscriber = commandClient.duplicate();
    await subscriber.connect();
    io.adapter(createAdapter(pubClient, subscriber));
    logger.info('Redis connected; Socket.IO Redis adapter enabled');
  } catch (error) {
    logger.warn({ err: error }, 'Redis unavailable; continuing with in-memory adapter/cache');
    await closeRedis();
  }
}

export async function closeRedis(): Promise<void> {
  const clients = [subscriber, commandClient].filter((client): client is Redis => Boolean(client));
  commandClient = null;
  subscriber = null;
  await Promise.allSettled(clients.map((client) => client.quit()));
}
