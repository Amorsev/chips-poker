import { Router } from 'express';
import { z } from 'zod';
import type { User } from '@prisma/client';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { AppError, asyncHandler } from '../errors.js';
import { logger } from '../logger.js';
import { sendPasswordResetEmail } from '../mailer.js';
import { randomHex, sha256 } from '../utils/crypto.js';
import { publicUser } from '../utils/serialize.js';
import { deviceFingerprint, ipHashFromRequest } from './device.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { signAccessToken } from './tokens.js';

export const authRouter = Router();

// A real bcrypt hash used to equalise timing when an email does not exist.
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.7Fq6i1FQx7h8y5T4b1nW7h1Q8w3nJ1K';

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Некорректный email')
  .max(320);

const passwordSchema = z
  .string()
  .min(8, 'Минимум 8 символов')
  .max(128)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Пароль слишком длинный (максимум 72 байта)');

const nicknameSchema = z
  .string()
  .trim()
  .min(3, 'Минимум 3 символа')
  .max(20, 'Максимум 20 символов')
  .regex(/^[A-Za-zА-Яа-яЁё0-9_]+$/u, 'Только буквы, цифры и подчёркивание');

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  nickname: nicknameSchema
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128)
});

const forgotSchema = z.object({ email: emailSchema });

const resetSchema = z.object({
  token: z.string().min(32).max(256),
  password: passwordSchema
});

function authResponse(user: User): { token: string; user: ReturnType<typeof publicUser> } {
  return {
    token: signAccessToken(user),
    user: publicUser(user)
  };
}

async function assertDeviceAllowed(fingerprint: string, ipHash: string): Promise<void> {
  if (config.ALLOW_MULTI_ACCOUNT) return;

  const existingDevice = await prisma.device.findFirst({
    where: { fingerprint },
    select: { userId: true }
  });
  if (existingDevice) {
    throw new AppError(
      403,
      'DEVICE_ALREADY_USED',
      'С этого устройства уже зарегистрирован аккаунт. Для смены аккаунта обратитесь в поддержку.'
    );
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1_000);
  const accountsFromIp = await prisma.device.findMany({
    where: { ipHash, firstSeenAt: { gte: since } },
    select: { userId: true },
    distinct: ['userId']
  });
  if (accountsFromIp.length >= config.ALLOWED_ACCOUNTS_PER_IP_24H) {
    throw new AppError(
      429,
      'TOO_MANY_ACCOUNTS',
      'С вашего IP за последние 24 часа зарегистрировано слишком много аккаунтов'
    );
  }
}

async function rememberDevice(userId: string, fingerprint: string, ipHash: string, userAgent?: string): Promise<void> {
  await prisma.device.upsert({
    where: { userId_fingerprint: { userId, fingerprint } },
    update: { ipHash, userAgent: userAgent?.slice(0, 500) ?? null },
    create: {
      userId,
      fingerprint,
      ipHash,
      userAgent: userAgent?.slice(0, 500) ?? null
    }
  });
}

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const fingerprint = deviceFingerprint(res);
    const ipHash = ipHashFromRequest(req);
    await assertDeviceAllowed(fingerprint, ipHash);

    const passwordHash = await hashPassword(body.password);
    const nicknameKey = body.nickname.toLocaleLowerCase('ru-RU');

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: body.email,
          passwordHash,
          nickname: body.nickname,
          nicknameKey,
          chips: config.WELCOME_BONUS,
          welcomeBonusClaimed: true,
          lastLoginAt: new Date(),
          lastSeenAt: new Date()
        }
      });
      await tx.chipTransaction.create({
        data: {
          userId: created.id,
          type: 'WELCOME_BONUS',
          amount: config.WELCOME_BONUS,
          balanceAfter: config.WELCOME_BONUS,
          reference: 'welcome'
        }
      });
      return created;
    });

    await rememberDevice(user.id, fingerprint, ipHash, req.get('user-agent'));
    logger.info({ userId: user.id, ipHash }, 'User registered');
    res.status(201).json(authResponse(user));
  })
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    const valid = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !valid) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Неверный email или пароль');
    }

    const fingerprint = deviceFingerprint(res);
    const ipHash = ipHashFromRequest(req);

    // A device linked to another account is not blocked at login (shared
    // computers are legitimate), but the link remains available for moderation.
    await rememberDevice(user.id, fingerprint, ipHash, req.get('user-agent'));
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastSeenAt: new Date() }
    });

    res.json(authResponse(updated));
  })
);

authRouter.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const body = forgotSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });

    if (user) {
      const rawToken = randomHex(32);
      await prisma.$transaction([
        prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
        prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: sha256(rawToken),
            expiresAt: new Date(Date.now() + 60 * 60 * 1_000)
          }
        })
      ]);

      // Built from the address the site was opened at unless PUBLIC_WEB_URL pins
      // it. With SMTP on a public server, set PUBLIC_WEB_URL: a forged Host
      // header could otherwise point the e-mailed link at another site.
      const baseUrl = (config.PUBLIC_WEB_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
      const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
      await sendPasswordResetEmail(user.email, resetUrl);
    }

    // Always the same answer to prevent account enumeration.
    res.json({ message: 'Если такой email существует, письмо со ссылкой отправлено' });
  })
);

authRouter.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const body = resetSchema.parse(req.body);
    const tokenHash = sha256(body.token);
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new AppError(400, 'INVALID_RESET_TOKEN', 'Ссылка недействительна или истекла');
    }

    const passwordHash = await hashPassword(body.password);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash, tokenVersion: { increment: 1 } }
      }),
      prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() }
      }),
      prisma.passwordResetToken.deleteMany({
        where: { userId: record.userId, id: { not: record.id } }
      })
    ]);

    // Existing access tokens are invalidated by the tokenVersion bump.
    res.json({ message: 'Пароль обновлён. Войдите с новым паролем.' });
  })
);
