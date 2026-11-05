import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { hashIp, sha256 } from '../utils/crypto.js';

const COOKIE_NAME = 'poker_did';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1_000;

/**
 * Issues an opaque, HttpOnly device cookie. The client sends it automatically;
 * the cookie itself is not a credential and grants no access.
 */
export function deviceMiddleware(req: Request, res: Response, next: NextFunction): void {
  let deviceId = req.cookies?.[COOKIE_NAME] as string | undefined;
  if (!deviceId || deviceId.length < 16 || deviceId.length > 128) {
    deviceId = randomUUID();
    res.cookie(COOKIE_NAME, deviceId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      maxAge: COOKIE_MAX_AGE,
      path: '/'
    });
  }
  res.locals.deviceFingerprint = sha256(deviceId);
  next();
}

export function requestIp(req: Request): string {
  if (config.TRUST_PROXY > 0) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0]!.trim();
    }
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function ipHashFromRequest(req: Request): string {
  return hashIp(requestIp(req));
}

export function deviceFingerprint(res: Response): string {
  return res.locals.deviceFingerprint as string;
}
