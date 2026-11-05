import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { cached } from '../cache.js';
import { chipsToNumber, leagueForTotalWon, leagueRange } from '../utils/serialize.js';

export type LeaderboardPeriod = 'all' | 'week' | 'today';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  avatarPreset: string;
  score: number;
  hands: number;
  league: string;
}

function periodStart(period: LeaderboardPeriod): Date | null {
  if (period === 'all') return null;
  const now = new Date();
  if (period === 'today') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000);
}

function userWhereForLeague(league?: string): Prisma.UserWhereInput {
  const range = leagueRange(league);
  if (range.gt === undefined && range.lte === undefined) return {};
  return {
    totalWon: {
      ...(range.gt !== undefined ? { gt: range.gt } : {}),
      ...(range.lte !== undefined ? { lte: range.lte } : {})
    }
  };
}

export async function getLeaderboard(period: LeaderboardPeriod, league?: string): Promise<LeaderboardEntry[]> {
  const cacheKey = `leaderboard:v1:${period}:${league ?? 'all'}`;
  return cached<LeaderboardEntry[]>(cacheKey, 45, async () => {
    if (period === 'all') {
      const users = await prisma.user.findMany({
        where: { totalWon: { gt: 0n }, ...userWhereForLeague(league) },
        orderBy: [{ totalWon: 'desc' }, { handsWon: 'desc' }, { createdAt: 'asc' }],
        take: 100,
        select: {
          id: true,
          nickname: true,
          avatarUrl: true,
          avatarPreset: true,
          totalWon: true,
          handsPlayed: true
        }
      });
      return users.map((user, index) => ({
        rank: index + 1,
        userId: user.id,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
        avatarPreset: user.avatarPreset,
        score: chipsToNumber(user.totalWon),
        hands: user.handsPlayed,
        league: leagueForTotalWon(user.totalWon)
      }));
    }

    const since = periodStart(period)!;
    const grouped = await prisma.handParticipant.groupBy({
      by: ['userId'],
      where: {
        playedAt: { gte: since },
        wonAmount: { gt: 0n },
        user: userWhereForLeague(league)
      },
      _sum: { wonAmount: true },
      _count: { _all: true },
      orderBy: { _sum: { wonAmount: 'desc' } },
      take: 100
    });

    if (grouped.length === 0) return [];
    const users = await prisma.user.findMany({
      where: { id: { in: grouped.map((row) => row.userId) } },
      select: {
        id: true,
        nickname: true,
        avatarUrl: true,
        avatarPreset: true,
        totalWon: true
      }
    });
    const byId = new Map(users.map((user) => [user.id, user]));
    const result: LeaderboardEntry[] = [];
    grouped.forEach((row, index) => {
      const user = byId.get(row.userId);
      if (!user) return;
      result.push({
        rank: index + 1,
        userId: user.id,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
        avatarPreset: user.avatarPreset,
        score: chipsToNumber(row._sum.wonAmount ?? 0n),
        hands: row._count._all,
        league: leagueForTotalWon(user.totalWon)
      });
    });
    return result;
  });
}
