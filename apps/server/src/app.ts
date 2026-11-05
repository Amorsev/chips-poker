import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { logger } from './logger.js';
import { prisma } from './db.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { deviceMiddleware } from './auth/device.js';
import { authRouter } from './auth/routes.js';
import { profileRouter } from './profile/routes.js';
import { lobbyRouter } from './lobby/routes.js';
import { leaderboardRouter } from './leaderboard/routes.js';
import { mountWebClient } from './web-client.js';

export function createApp(): express.Express {
  const app = express();

  app.set('trust proxy', config.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' }
    })
  );
  // No CORS middleware: the browser always talks to the API on the same origin
  // it loaded the site from, whatever host name or IP address that is.
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' }
    })
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser(config.DEVICE_COOKIE_SECRET));
  app.use(deviceMiddleware);

  // Uploaded avatars are public, immutable-ish assets. They are served by the
  // API (and proxied by nginx in the Docker deployment).
  app.use(
    '/uploads',
    express.static(config.uploadDir, {
      fallthrough: false,
      maxAge: config.isProduction ? '7d' : 0,
      immutable: config.isProduction
    })
  );

  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1_000,
    limit: 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Слишком много запросов. Попробуйте позже.' } }
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1_000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Слишком много попыток. Попробуйте позже.' } }
  });

  app.use('/api', generalLimiter);
  app.use('/api/auth', authLimiter);

  app.get('/api/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', uptime: Math.round(process.uptime()), timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', timestamp: new Date().toISOString() });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/profile', profileRouter);
  app.use('/api/lobby', lobbyRouter);
  app.use('/api/leaderboard', leaderboardRouter);

  if (config.webDistDir) mountWebClient(app, config.webDistDir);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
