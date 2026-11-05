import { Router } from 'express';
import multer from 'multer';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { AppError, asyncHandler } from '../errors.js';
import { authenticate } from '../auth/middleware.js';
import { publicUser } from '../utils/serialize.js';
import { AVATAR_PRESETS, saveAvatar } from './avatars.js';

export const profileRouter = Router();
profileRouter.use(authenticate);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 }
});

const updateSchema = z
  .object({
    nickname: z
      .string()
      .trim()
      .min(3)
      .max(20)
      .regex(/^[A-Za-zА-Яа-яЁё0-9_]+$/u)
      .optional(),
    avatarPreset: z.enum(AVATAR_PRESETS).optional()
  })
  .refine((value) => value.nickname !== undefined || value.avatarPreset !== undefined, {
    message: 'Нет полей для обновления'
  });

function serializeHand(entry: {
  seat: number;
  holeCards: string;
  wonAmount: bigint;
  netAmount: bigint;
  result: string;
  folded: boolean;
  bestHand: string | null;
  playedAt: Date;
  hand: {
    id: string;
    tableName: string;
    league: string;
    board: string;
    pot: bigint;
  };
}) {
  return {
    id: entry.hand.id,
    tableName: entry.hand.tableName,
    league: entry.hand.league,
    board: entry.hand.board.split(' ').filter(Boolean),
    holeCards: entry.holeCards.split(' ').filter(Boolean),
    pot: Number(entry.hand.pot),
    wonAmount: Number(entry.wonAmount),
    netAmount: Number(entry.netAmount),
    result: entry.result,
    folded: entry.folded,
    bestHand: entry.bestHand,
    playedAt: entry.playedAt.toISOString()
  };
}

profileRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const [recentHands, transactions] = await Promise.all([
      prisma.handParticipant.findMany({
        where: { userId: req.authUser.id },
        include: { hand: true },
        orderBy: { playedAt: 'desc' },
        take: 10
      }),
      prisma.chipTransaction.findMany({
        where: { userId: req.authUser.id },
        orderBy: { createdAt: 'desc' },
        take: 8
      })
    ]);

    res.json({
      user: publicUser(req.authUser),
      avatarPresets: AVATAR_PRESETS,
      recentHands: recentHands.map(serializeHand),
      transactions: transactions.map((entry) => ({
        id: entry.id,
        type: entry.type,
        amount: Number(entry.amount),
        balanceAfter: Number(entry.balanceAfter),
        createdAt: entry.createdAt.toISOString()
      }))
    });
  })
);

profileRouter.patch(
  '/me',
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.authUser.id },
      data: {
        ...(body.nickname
          ? { nickname: body.nickname, nicknameKey: body.nickname.toLocaleLowerCase('ru-RU') }
          : {}),
        ...(body.avatarPreset ? { avatarPreset: body.avatarPreset } : {})
      }
    });
    res.json({ user: publicUser(user) });
  })
);

profileRouter.post(
  '/avatar',
  upload.single('avatar'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError(400, 'FILE_REQUIRED', 'Выберите изображение');
    const avatarUrl = await saveAvatar(req.file.buffer);
    const previous = req.authUser.avatarUrl;

    const user = await prisma.user.update({
      where: { id: req.authUser.id },
      data: { avatarUrl }
    });

    if (previous?.startsWith('/uploads/avatars/')) {
      const filename = path.basename(previous);
      await unlink(path.join(config.uploadDir, 'avatars', filename)).catch(() => undefined);
    }

    res.json({ user: publicUser(user) });
  })
);

profileRouter.get(
  '/hands',
  asyncHandler(async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(50).default(20).parse(req.query.limit);
    const hands = await prisma.handParticipant.findMany({
      where: { userId: req.authUser.id },
      include: { hand: true },
      orderBy: { playedAt: 'desc' },
      take: limit
    });
    res.json({ hands: hands.map(serializeHand) });
  })
);
