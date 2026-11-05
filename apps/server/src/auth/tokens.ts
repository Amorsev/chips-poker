import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config.js';
import { AppError } from '../errors.js';

export interface AccessTokenPayload {
  sub: string;
  ver: number;
  nickname: string;
}

export function signAccessToken(user: { id: string; tokenVersion: number; nickname: string }): string {
  const payload: AccessTokenPayload = {
    sub: user.id,
    ver: user.tokenVersion,
    nickname: user.nickname
  };
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    issuer: 'chips-poker',
    audience: 'chips-poker-web'
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, {
      issuer: 'chips-poker',
      audience: 'chips-poker-web'
    });
    if (
      typeof payload === 'string' ||
      typeof payload.sub !== 'string' ||
      typeof payload.ver !== 'number' ||
      typeof payload.nickname !== 'string'
    ) {
      throw new Error('Malformed token');
    }
    return payload as AccessTokenPayload;
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'Сессия недействительна или истекла');
  }
}
