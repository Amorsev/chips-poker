import type { League, User } from '@prisma/client';

export type LeagueKey = 'BEGINNER' | 'AMATEUR' | 'PRO' | 'HIGHROLLER';

export const LEAGUES: Array<{
  key: LeagueKey;
  name: string;
  minTotalWon: number;
  smallBlind: number;
  bigBlind: number;
  color: string;
}> = [
  { key: 'BEGINNER', name: 'Новичок', minTotalWon: 0, smallBlind: 10, bigBlind: 20, color: '#43d6a2' },
  { key: 'AMATEUR', name: 'Любитель', minTotalWon: 5_000, smallBlind: 50, bigBlind: 100, color: '#5aa9ff' },
  { key: 'PRO', name: 'Профи', minTotalWon: 50_000, smallBlind: 200, bigBlind: 400, color: '#c084fc' },
  { key: 'HIGHROLLER', name: 'Хайроллер', minTotalWon: 500_000, smallBlind: 1_000, bigBlind: 2_000, color: '#f5b544' }
];

/**
 * BigInt is used for money-like values in PostgreSQL. JavaScript clients can
 * safely consume these values as numbers up to 2^53; the cap protects against
 * silent precision loss in this play-money product.
 */
export function chipsToNumber(value: bigint): number {
  const max = 9_007_199_254_740_991n;
  return Number(value > max ? max : value);
}

export function leagueForTotalWon(totalWon: bigint | number): LeagueKey {
  const value = typeof totalWon === 'bigint' ? totalWon : BigInt(Math.trunc(totalWon));
  if (value > 500_000n) return 'HIGHROLLER';
  if (value > 50_000n) return 'PRO';
  if (value > 5_000n) return 'AMATEUR';
  return 'BEGINNER';
}

export function leagueRange(league?: string): { gt?: bigint; lte?: bigint } {
  switch (league) {
    case 'BEGINNER':
      return { lte: 5_000n };
    case 'AMATEUR':
      return { gt: 5_000n, lte: 50_000n };
    case 'PRO':
      return { gt: 50_000n, lte: 500_000n };
    case 'HIGHROLLER':
      return { gt: 500_000n };
    default:
      return {};
  }
}

export function publicUser(user: User) {
  const winRate = user.handsPlayed > 0 ? user.handsWon / user.handsPlayed : 0;
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    avatarPreset: user.avatarPreset,
    chips: chipsToNumber(user.chips),
    totalWon: chipsToNumber(user.totalWon),
    totalLost: chipsToNumber(user.totalLost),
    handsPlayed: user.handsPlayed,
    handsWon: user.handsWon,
    winRate: Math.round(winRate * 10_000) / 100,
    league: leagueForTotalWon(user.totalWon) as League,
    welcomeBonusClaimed: user.welcomeBonusClaimed,
    createdAt: user.createdAt.toISOString()
  };
}
