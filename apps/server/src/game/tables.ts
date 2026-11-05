import type { LeagueKey } from '../utils/serialize.js';

export interface TableConfig {
  id: string;
  name: string;
  league: LeagueKey;
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  minTotalWon: number;
}

const DEFINITIONS: Array<Omit<TableConfig, 'id' | 'name' | 'minBuyIn' | 'maxBuyIn' | 'minTotalWon'>> = [
  { league: 'BEGINNER', maxSeats: 6, smallBlind: 10, bigBlind: 20 },
  { league: 'BEGINNER', maxSeats: 6, smallBlind: 10, bigBlind: 20 },
  { league: 'BEGINNER', maxSeats: 9, smallBlind: 10, bigBlind: 20 },
  { league: 'AMATEUR', maxSeats: 6, smallBlind: 50, bigBlind: 100 },
  { league: 'AMATEUR', maxSeats: 9, smallBlind: 50, bigBlind: 100 },
  { league: 'PRO', maxSeats: 6, smallBlind: 200, bigBlind: 400 },
  { league: 'PRO', maxSeats: 9, smallBlind: 200, bigBlind: 400 },
  { league: 'HIGHROLLER', maxSeats: 6, smallBlind: 1_000, bigBlind: 2_000 },
  { league: 'HIGHROLLER', maxSeats: 9, smallBlind: 1_000, bigBlind: 2_000 }
];

const LEAGUE_META: Record<LeagueKey, { label: string; minTotalWon: number }> = {
  BEGINNER: { label: 'Новичок', minTotalWon: 0 },
  AMATEUR: { label: 'Любитель', minTotalWon: 5_000 },
  PRO: { label: 'Профи', minTotalWon: 50_000 },
  HIGHROLLER: { label: 'Хайроллер', minTotalWon: 500_000 }
};

export const TABLE_CONFIGS: TableConfig[] = DEFINITIONS.map((definition, index) => {
  const ordinal = DEFINITIONS.slice(0, index).filter((item) => item.league === definition.league).length + 1;
  return {
    ...definition,
    id: `${definition.league.toLowerCase()}-${definition.maxSeats}max-${ordinal}`,
    name: `${LEAGUE_META[definition.league].label} #${ordinal} · ${definition.maxSeats}-max`,
    minBuyIn: definition.bigBlind * 40,
    maxBuyIn: definition.bigBlind * 200,
    minTotalWon: LEAGUE_META[definition.league].minTotalWon
  };
});
