import { secureRandomInt } from '../utils/random.js';

export type Suit = 's' | 'h' | 'd' | 'c';

export interface Card {
  rank: number; // 2..14 (14 = ace)
  suit: Suit;
}

export const SUITS: Suit[] = ['s', 'h', 'd', 'c'];
export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

export const SUIT_SYMBOL: Record<Suit, string> = {
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣'
};

export const RANK_LABEL: Record<number, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A'
};

export function cardToString(card: Card): string {
  return `${RANK_LABEL[card.rank]}${card.suit}`;
}

export function parseCard(value: string): Card {
  const suit = value.slice(-1) as Suit;
  const rankLabel = value.slice(0, -1);
  const rank = Object.entries(RANK_LABEL).find(([, label]) => label === rankLabel)?.[0];
  if (!SUITS.includes(suit) || !rank) throw new Error(`Invalid card: ${value}`);
  return { rank: Number(rank), suit };
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit });
  }
  return deck;
}

/**
 * Fisher–Yates with crypto.randomInt. Math.random must never be used for
 * shuffling a poker deck.
 */
export function createShuffledDeck(): Card[] {
  const deck = createDeck();
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = secureRandomInt(i + 1);
    const current = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = current;
  }
  return deck;
}

export function cardsToString(cards: Card[]): string[] {
  return cards.map(cardToString);
}
