import { describe, expect, it } from 'vitest';
import { parseCard } from './cards.js';
import { describeHand, evaluateBest, evaluateFive } from './evaluator.js';

const cards = (values: string) => values.split(' ').map(parseCard);

describe('hand evaluator', () => {
  it('ranks a royal flush above quads', () => {
    const flush = evaluateFive(cards('As Ks Qs Js 10s'));
    const quads = evaluateFive(cards('Ah Ad Ac As Kd'));
    expect(flush.category).toBe('STRAIGHT_FLUSH');
    expect(flush.score).toBeGreaterThan(quads.score);
  });

  it('recognises the wheel straight and orders it below six-high', () => {
    const wheel = evaluateFive(cards('As 2d 3c 4h 5s'));
    const sixHigh = evaluateFive(cards('2s 3d 4c 5h 6s'));
    expect(wheel.category).toBe('STRAIGHT');
    expect(sixHigh.score).toBeGreaterThan(wheel.score);
  });

  it('picks the best full house from two trips', () => {
    const hand = evaluateBest(cards('Ah Ad Ac Kh Kd Kc 2s'));
    expect(hand.category).toBe('FULL_HOUSE');
    // Aces full of kings must beat kings full of aces.
    expect(hand.score).toBeGreaterThan(evaluateFive(cards('Kh Kd Kc Ah Ad')).score);
  });

  it('uses kickers correctly', () => {
    const aceKicker = evaluateFive(cards('Qh Qd 7c 5s As'));
    const kingKicker = evaluateFive(cards('Qh Qd 7c 5s Ks'));
    expect(aceKicker.score).toBeGreaterThan(kingKicker.score);
  });

  it('finds a flush in seven cards', () => {
    const hand = evaluateBest(cards('2h 9h Jh Qh Kh 3s 4d'));
    expect(hand.category).toBe('FLUSH');
  });

  it('names every combination with its concrete ranks', () => {
    expect(evaluateFive(cards('2s 3d 4c 5h 6s')).name).toBe('Стрит 2–6');
    expect(evaluateFive(cards('As 2d 3c 4h 5s')).name).toBe('Стрит A–5');
    expect(evaluateFive(cards('As Js 9s 7s 5s')).name).toBe('Флеш A–J');
    expect(evaluateFive(cards('8h 8d 8c 5s 5d')).name).toBe('Фулл-хаус: 8 и 5');
    expect(evaluateFive(cards('9h 9d 9c 9s Ad')).name).toBe('Каре 9');
    expect(evaluateFive(cards('Ah Ad 7c 7s Kd')).name).toBe('Две пары: A и 7');
    expect(evaluateFive(cards('Kh Kd 7c 5s 2d')).name).toBe('Пара K');
    expect(evaluateFive(cards('8h 8d 8c Ks 2d')).name).toBe('Сет 8');
    expect(evaluateFive(cards('5s 6s 7s 8s 9s')).name).toBe('Стрит-флеш 5–9');
  });

  it('describes the current hand before and after the flop', () => {
    expect(describeHand(cards('Ah As'))).toBe('Пара A');
    expect(describeHand(cards('Ah Kd'))).toBe('Старшая карта A');
    expect(describeHand([])).toBeNull();
    expect(describeHand(cards('2s 3d 4c 5h 6s Kh'))).toBe('Стрит 2–6');
  });
});
