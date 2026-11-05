import { RANK_LABEL, type Card } from './cards.js';

export type HandCategory =
  | 'HIGH_CARD'
  | 'PAIR'
  | 'TWO_PAIR'
  | 'TRIPS'
  | 'STRAIGHT'
  | 'FLUSH'
  | 'FULL_HOUSE'
  | 'QUADS'
  | 'STRAIGHT_FLUSH';

const CATEGORY_VALUE: Record<HandCategory, number> = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8
};

export const CATEGORY_LABEL: Record<HandCategory, string> = {
  HIGH_CARD: 'Старшая карта',
  PAIR: 'Пара',
  TWO_PAIR: 'Две пары',
  TRIPS: 'Сет',
  STRAIGHT: 'Стрит',
  FLUSH: 'Флеш',
  FULL_HOUSE: 'Фулл-хаус',
  QUADS: 'Каре',
  STRAIGHT_FLUSH: 'Стрит-флеш'
};

export interface EvaluatedHand {
  score: number;
  category: HandCategory;
  name: string;
  /** The five cards that form the best hand (useful for highlighting). */
  cards: Card[];
}

const BASE = 15;

function rankLabel(rank: number): string {
  return RANK_LABEL[rank] ?? '?';
}

/** Concrete straight range, e.g. "2–6". The wheel reads "A–5". */
function straightRange(high: number, ranks: number[]): string {
  if (high === 5 && ranks.includes(14)) return 'A–5';
  return `${rankLabel(high - 4)}–${rankLabel(high)}`;
}

/** A flush's two highest cards, e.g. "A–J" for an ace-jack-high flush. */
function flushRange(ranks: number[]): string {
  return `${rankLabel(ranks[0] ?? 0)}–${rankLabel(ranks[1] ?? 0)}`;
}

/**
 * A score that can be compared with a simple number. Five base-15 digits are
 * enough for all tie-breakers; category is the most significant digit.
 */
function encode(category: HandCategory, ranks: number[]): number {
  let value = CATEGORY_VALUE[category];
  for (let i = 0; i < 5; i += 1) {
    value = value * BASE + (ranks[i] ?? 0);
  }
  return value;
}

function straightHigh(ranks: number[]): number | null {
  const unique = [...new Set(ranks)].sort((a, b) => b - a);
  // Wheel: A-2-3-4-5, where the ace plays as low.
  if (unique.includes(14)) unique.push(1);
  let run = 1;
  for (let i = 1; i < unique.length; i += 1) {
    if (unique[i] === unique[i - 1]! - 1) {
      run += 1;
      if (run >= 5) return unique[i - 4]!;
    } else {
      run = 1;
    }
  }
  return null;
}

export function evaluateFive(cards: Card[]): EvaluatedHand {
  if (cards.length !== 5) throw new Error('evaluateFive expects exactly five cards');

  const sorted = [...cards].sort((a, b) => b.rank - a.rank);
  const ranks = sorted.map((card) => card.rank);
  const isFlush = sorted.every((card) => card.suit === sorted[0]!.suit);
  const highStraight = straightHigh(ranks);

  if (isFlush && highStraight !== null) {
    return {
      score: encode('STRAIGHT_FLUSH', [highStraight]),
      category: 'STRAIGHT_FLUSH',
      name: `Стрит-флеш ${straightRange(highStraight, ranks)}`,
      cards: sorted
    };
  }

  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const quad = groups.find(([, count]) => count === 4);
  const trips = groups.filter(([, count]) => count === 3);
  const pairs = groups.filter(([, count]) => count === 2);

  if (quad) {
    const kicker = groups.find(([, count]) => count === 1)?.[0] ?? 0;
    return {
      score: encode('QUADS', [quad[0], kicker]),
      category: 'QUADS',
      name: `Каре ${rankLabel(quad[0])}`,
      cards: sorted
    };
  }

  if (trips.length >= 2) {
    const highTrips = trips[0]![0];
    const lowTrips = trips[1]![0];
    return {
      score: encode('FULL_HOUSE', [highTrips, lowTrips]),
      category: 'FULL_HOUSE',
      name: `Фулл-хаус: ${rankLabel(highTrips)} и ${rankLabel(lowTrips)}`,
      cards: sorted
    };
  }

  if (trips.length === 1 && pairs.length >= 1) {
    return {
      score: encode('FULL_HOUSE', [trips[0]![0], pairs[0]![0]]),
      category: 'FULL_HOUSE',
      name: `Фулл-хаус: ${rankLabel(trips[0]![0])} и ${rankLabel(pairs[0]![0])}`,
      cards: sorted
    };
  }

  if (isFlush) {
    return {
      score: encode('FLUSH', ranks),
      category: 'FLUSH',
      name: `Флеш ${flushRange(ranks)}`,
      cards: sorted
    };
  }

  if (highStraight !== null) {
    return {
      score: encode('STRAIGHT', [highStraight]),
      category: 'STRAIGHT',
      name: `Стрит ${straightRange(highStraight, ranks)}`,
      cards: sorted
    };
  }

  if (trips.length === 1) {
    const kickers = groups.filter(([, count]) => count === 1).map(([rank]) => rank).slice(0, 2);
    return {
      score: encode('TRIPS', [trips[0]![0], ...kickers]),
      category: 'TRIPS',
      name: `Сет ${rankLabel(trips[0]![0])}`,
      cards: sorted
    };
  }

  if (pairs.length >= 2) {
    const kicker = groups.find(([, count]) => count === 1)?.[0] ?? 0;
    return {
      score: encode('TWO_PAIR', [pairs[0]![0], pairs[1]![0], kicker]),
      category: 'TWO_PAIR',
      name: `Две пары: ${rankLabel(pairs[0]![0])} и ${rankLabel(pairs[1]![0])}`,
      cards: sorted
    };
  }

  if (pairs.length === 1) {
    const kickers = groups.filter(([, count]) => count === 1).map(([rank]) => rank).slice(0, 3);
    return {
      score: encode('PAIR', [pairs[0]![0], ...kickers]),
      category: 'PAIR',
      name: `Пара ${rankLabel(pairs[0]![0])}`,
      cards: sorted
    };
  }

  return {
    score: encode('HIGH_CARD', ranks),
    category: 'HIGH_CARD',
    name: `Старшая карта ${rankLabel(ranks[0] ?? 0)}`,
    cards: sorted
  };
}

function combinations<T>(items: T[], choose: number): T[][] {
  const result: T[][] = [];
  const buffer: T[] = [];
  function walk(start: number): void {
    if (buffer.length === choose) {
      result.push([...buffer]);
      return;
    }
    for (let i = start; i < items.length; i += 1) {
      buffer.push(items[i]!);
      walk(i + 1);
      buffer.pop();
    }
  }
  walk(0);
  return result;
}

/** Best five-card hand from 5–7 cards (21 combinations at most). */
export function evaluateBest(cards: Card[]): EvaluatedHand {
  if (cards.length < 5 || cards.length > 7) throw new Error('evaluateBest expects 5 to 7 cards');
  let best: EvaluatedHand | null = null;
  for (const five of combinations(cards, 5)) {
    const evaluated = evaluateFive(five);
    if (!best || evaluated.score > best.score) best = evaluated;
  }
  return best!;
}

/**
 * Human-readable hand label for any point in a hand. Two cards (preflop) can
 * only be a pocket pair or a high card; from the flop onwards the best five
 * cards are evaluated, exactly as at showdown. Null means no cards are dealt.
 */
export function describeHand(cards: Card[]): string | null {
  if (cards.length >= 5 && cards.length <= 7) return evaluateBest(cards).name;
  if (cards.length === 2) {
    const [first, second] = cards;
    if (!first || !second) return null;
    if (first.rank === second.rank) return `Пара ${rankLabel(first.rank)}`;
    return `Старшая карта ${rankLabel(Math.max(first.rank, second.rank))}`;
  }
  return null;
}
