import type { NextFunction, Request, Response } from 'express';
import type { User } from '@prisma/client';
import { prisma } from '../db.js';
import { AppError, asyncHandler } from '../errors.js';
import { verifyAccessToken } from './tokens.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser: User;
    }
  }
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * JWT gives fast, stateless verification; the DB lookup lets us revoke sessions
 * immediately (tokenVersion is bumped on password reset).
 */
export const authenticate = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = bearerToken(req);
  if (!token) throw new AppError(401, 'UNAUTHORIZED', 'Требуется авторизация');

  const payload = verifyAccessToken(token);
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.tokenVersion !== payload.ver) {
    throw new AppError(401, 'UNAUTHORIZED', 'Сессия недействительна');
  }

  req.authUser = user;
  next();
});

export function authTokenFromRequest(req: Request): string | null {
  return bearerToken(req);
}
