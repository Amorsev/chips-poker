import { describe, expect, it } from 'vitest';
import { HoldemEngine, type EngineConfig, type PlayerAction } from './engine.js';

function engine(players = 3, stacks = [1_000, 1_000, 1_000]): HoldemEngine {
  const config: EngineConfig = {
    tableId: 'test',
    tableName: 'Test',
    league: 'BEGINNER',
    maxSeats: 6,
    smallBlind: 10,
    bigBlind: 20,
    handNumber: 1,
    previousButtonSeat: null,
    players: stacks.slice(0, players).map((stack, index) => ({
      userId: `u${index + 1}`,
      nickname: `P${index + 1}`,
      seat: index,
      stack
    }))
  };
  return new HoldemEngine(config);
}

function act(e: HoldemEngine, userId: string, action: PlayerAction): void {
  e.act(userId, action);
}

describe('HoldemEngine', () => {
  it('posts blinds and assigns pre-flop action correctly for 3 players', () => {
    const e = engine();
    const state = e.getState('u1');
    expect(state.buttonSeat).toBe(0);
    expect(state.smallBlindSeat).toBe(1);
    expect(state.bigBlindSeat).toBe(2);
    expect(state.actingSeat).toBe(0); // UTG = button in 3-handed
    expect(state.pot).toBe(30);
  });

  it('handles a fold-around win without showdown', () => {
    const e = engine();
    act(e, 'u1', { type: 'fold' });
    act(e, 'u2', { type: 'fold' });
    expect(e.isComplete()).toBe(true);
    const result = e.getResult()!;
    expect(result.showdown).toBe(false);
    expect(result.winners[0]!.userId).toBe('u3');
    expect(result.pot).toBe(30);
  });

  it('lets the big blind check their option and advances to the flop', () => {
    const e = engine();
    act(e, 'u1', { type: 'call' });
    act(e, 'u2', { type: 'call' }); // SB completes
    act(e, 'u3', { type: 'check' }); // BB option
    const state = e.getState('u1');
    expect(state.street).toBe('flop');
    expect(state.board).toHaveLength(3);
    expect(state.pot).toBe(60);
    expect(state.actingSeat).toBe(1); // first player left of the button
  });

  it('exposes the viewer a concrete live combination', () => {
    const e = engine();
    const preflop = e.getState('u1').you!;
    expect(preflop.holeCards).toHaveLength(2);
    expect(preflop.handName).toMatch(/^(Пара|Старшая карта) /);

    act(e, 'u1', { type: 'call' });
    act(e, 'u2', { type: 'call' });
    act(e, 'u3', { type: 'check' });
    const flop = e.getState('u1').you!;
    expect(flop.handName).toMatch(
      /^(Старшая карта|Пара|Две пары|Сет|Стрит|Флеш|Фулл-хаус|Каре|Стрит-флеш) /
    );
  });

  it('rejects an invalid raise and accepts a minimum raise', () => {
    const e = engine();
    expect(() => act(e, 'u1', { type: 'raise', amount: 30 })).toThrow(/Минимальное повышение/);
    act(e, 'u1', { type: 'raise', amount: 40 });
    const state = e.getState('u2');
    expect(state.currentBet).toBe(40);
    expect(state.minRaise).toBe(20);
  });

  it('reopens action after a full raise', () => {
    const e = engine();
    act(e, 'u1', { type: 'call' });
    act(e, 'u2', { type: 'raise', amount: 60 });
    act(e, 'u3', { type: 'call' });
    // u1 has already acted but now owes chips and may raise again.
    const legal = e.getState('u1').you!.legalActions!;
    expect(legal.canCall).toBe(true);
    expect(legal.canRaise).toBe(true);
    expect(legal.callAmount).toBe(40);
  });

  it('does not reopen raising rights after a short all-in', () => {
    // BB has 150: the all-in raise to 150 is only +50 over the bet to 100,
    // which is less than a full raise (100). u1 may call but not re-raise.
    const e = engine(3, [1_000, 1_000, 150]);
    act(e, 'u1', { type: 'raise', amount: 100 });
    act(e, 'u2', { type: 'fold' });
    expect(() => act(e, 'u3', { type: 'allin' })).not.toThrow();
    const legal = e.getState('u1').you!.legalActions!;
    expect(legal.canCall).toBe(true);
    expect(legal.canRaise).toBe(false);
  });

  it('builds side pots when stacks differ', () => {
    const e = engine(3, [100, 200, 300]);
    act(e, 'u1', { type: 'allin' });
    act(e, 'u2', { type: 'allin' });
    act(e, 'u3', { type: 'allin' });
    expect(e.isComplete()).toBe(true);
    const result = e.getResult()!;
    expect(result.showdown).toBe(true);
    expect(result.pot).toBe(600);
    expect(result.pots.length).toBeGreaterThanOrEqual(2);
    const totalAwarded = result.participants.reduce((sum, p) => sum + p.payout, 0);
    expect(totalAwarded).toBe(600);
  });

  it('never lets a player act out of turn', () => {
    const e = engine();
    expect(() => act(e, 'u2', { type: 'call' })).toThrow(/не ваш ход/);
  });

  it('times out with a check when checking is free', () => {
    const e = engine();
    act(e, 'u1', { type: 'call' });
    act(e, 'u2', { type: 'call' });
    // BB has the option and can check for free.
    e.timeout('u3');
    expect(e.getState().street).toBe('flop');
  });
});
