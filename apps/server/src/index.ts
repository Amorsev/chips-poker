import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { prisma } from './db.js';
import { initRedis, closeRedis } from './redis.js';
import { initSocket } from './realtime/gateway.js';
import { tableManager } from './game/table-manager.js';

async function main(): Promise<void> {
  // Must run before the first client connects: any stake debited by a previous
  // process but never cashed out is returned to the bankroll.
  await tableManager.recoverTableStakes();

  const app = createApp();
  const httpServer = createServer(app);

  // No CORS configuration: the web client is always served from the same
  // origin as the API (Express in the container, the Vite proxy in dev), so the
  // site works on whatever address it is opened at.
  const io = new Server(httpServer, {
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 20_000,
    pingTimeout: 15_000
  });

  await initRedis(io);
  await initSocket(io);

  httpServer.listen(config.PORT, () => {
    logger.info(
      { port: config.PORT, env: config.NODE_ENV, servesWebClient: Boolean(config.webDistDir) },
      'Chips Poker API is listening'
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown started');
    io.close();
    httpServer.close();
    await Promise.allSettled([prisma.$disconnect(), closeRedis()]);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'Unhandled rejection'));
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    process.exit(1);
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start server');
  process.exit(1);
});
