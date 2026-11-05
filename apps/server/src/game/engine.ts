import { randomUUID } from 'node:crypto';
import { cardsToString, createShuffledDeck, type Card } from './cards.js';
import { evaluateBest, describeHand, type EvaluatedHand } from './evaluator.js';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export interface PlayerAction {
  type: ActionType;
  /** For bet/raise this is the TOTAL amount of the player's street bet. */
  amount?: number;
}

export interface EnginePlayerInput {
  userId: string;
  nickname: string;
  avatarUrl?: string | null;
  avatarPreset?: string;
  seat: number;
  stack: number;
}

export interface EngineConfig {
  tableId: string;
  tableName: string;
  league: string;
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  handNumber: number;
  /** Previous hand's button seat, or null for the very first hand. */
  previousButtonSeat: number | null;
  players: EnginePlayerInput[];
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canBet: boolean;
  betMin: number;
  betMax: number;
  canRaise: boolean;
  raiseMin: number;
  raiseMax: number;
  canAllIn: boolean;
  allInAmount: number;
}

export interface PublicPlayer {
  seat: number;
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  avatarPreset: string;
  stack: number;
  bet: number;
  committed: number;
  folded: boolean;
  allIn: boolean;
  hasActed: boolean;
  isButton: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  cards?: string[];
  lastAction?: { type: ActionType; amount: number };
}

export interface HandWinner {
  seat: number;
  userId: string;
  nickname: string;
  amount: number;
  handName: string | null;
  cards: string[];
}

export interface HandResult {
  handId: string;
  handNumber: number;
  tableId: string;
  board: string[];
  pot: number;
  startedAt: string;
  endedAt: string;
  showdown: boolean;
  winners: HandWinner[];
  participants: Array<{
    userId: string;
    nickname: string;
    seat: number;
    startingStack: number;
    endingStack: number;
    committed: number;
    payout: number;
    folded: boolean;
    holeCards: string;
    bestHand: string | null;
    bestCards: string[];
    result: 'WON' | 'LOST' | 'FOLDED';
  }>;
  pots: Array<{
    amount: number;
    eligibleSeats: number[];
    winners: Array<{ seat: number; amount: number }>;
  }>;
}

export interface EngineState {
  handId: string;
  handNumber: number;
  phase: 'playing' | 'complete';
  street: Street;
  board: string[];
  pot: number;
  currentBet: number;
  minRaise: number;
  buttonSeat: number;
  smallBlindSeat: number | null;
  bigBlindSeat: number | null;
  actingSeat: number | null;
  players: PublicPlayer[];
  lastAction: { seat: number; type: ActionType; amount: number } | null;
  result: HandResult | null;
  you: {
    seat: number;
    holeCards: string[];
    handName: string | null;
    legalActions: LegalActions | null;
  } | null;
}

interface InternalPlayer extends EnginePlayerInput {
  stack: number;
  startingStack: number;
  bet: number;
  committed: number;
  folded: boolean;
  allIn: boolean;
  hasActed: boolean;
  canRaise: boolean;
  holeCards: Card[];
  lastAction?: { type: ActionType; amount: number };
  evaluated?: EvaluatedHand;
  payout: number;
}

export class PokerRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PokerRuleError';
  }
}

/**
 * Authoritative, framework-independent no-limit Hold'em state machine.
 *
 * The class owns one hand. It never touches the database or sockets, which
 * makes it deterministic (apart from the secure deck shuffle) and unit-testable.
 */
export class HoldemEngine {
  readonly handId: string;
  readonly handNumber: number;
  readonly tableId: string;
  readonly tableName: string;
  readonly league: string;
  readonly maxSeats: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly startedAt: Date;

  private readonly players: InternalPlayer[];
  private deck: Card[];
  private community: Card[] = [];
  private street: Street = 'preflop';
  private phase: 'playing' | 'complete' = 'playing';
  private currentBet = 0;
  private minRaise: number;
  private actingSeat: number | null = null;
  private buttonSeat: number;
  private smallBlindSeat: number | null = null;
  private bigBlindSeat: number | null = null;
  private lastAction: { seat: number; type: ActionType; amount: number } | null = null;
  private result: HandResult | null = null;

  constructor(config: EngineConfig) {
    if (config.players.length < 2) throw new PokerRuleError('Для раздачи нужно минимум два игрока');
    if (config.players.length > config.maxSeats) throw new PokerRuleError('Слишком много игроков');
    if (new Set(config.players.map((player) => player.seat)).size !== config.players.length) {
      throw new PokerRuleError('Места игроков должны быть уникальны');
    }
    if (config.players.some((player) => player.stack <= 0 || !Number.isSafeInteger(player.stack))) {
      throw new PokerRuleError('У всех участников должен быть положительный целый стек');
    }

    this.handId = randomUUID();
    this.handNumber = config.handNumber;
    this.tableId = config.tableId;
    this.tableName = config.tableName;
    this.league = config.league;
    this.maxSeats = config.maxSeats;
    this.smallBlind = config.smallBlind;
    this.bigBlind = config.bigBlind;
    this.minRaise = config.bigBlind;
    this.startedAt = new Date();
    this.deck = createShuffledDeck();

    this.players = config.players
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((player) => ({
        ...player,
        stack: player.stack,
        startingStack: player.stack,
        bet: 0,
        committed: 0,
        folded: false,
        allIn: false,
        hasActed: false,
        canRaise: true,
        holeCards: [],
        payout: 0
      }));

    this.buttonSeat = this.nextOccupiedSeat(config.previousButtonSeat ?? -1);
    this.assignBlindSeats();
    this.dealHoleCards();
    this.postBlinds();
    this.beginBetting();
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  private assignBlindSeats(): void {
    if (this.players.length === 2) {
      // Heads-up: the button is the small blind and acts first pre-flop.
      this.smallBlindSeat = this.buttonSeat;
      this.bigBlindSeat = this.nextOccupiedSeat(this.buttonSeat);
      return;
    }
    this.smallBlindSeat = this.nextOccupiedSeat(this.buttonSeat);
    this.bigBlindSeat = this.nextOccupiedSeat(this.smallBlindSeat);
  }

  private dealHoleCards(): void {
    // Start left of the button and deal one card at a time, twice.
    const order: InternalPlayer[] = [];
    let seat = this.nextOccupiedSeat(this.buttonSeat);
    for (let i = 0; i < this.players.length; i += 1) {
      const player = this.playerAtSeat(seat);
      if (player) order.push(player);
      seat = this.nextOccupiedSeat(seat);
    }
    for (let round = 0; round < 2; round += 1) {
      for (const player of order) player.holeCards.push(this.draw());
    }
  }

  private postBlinds(): void {
    const sb = this.playerAtSeat(this.smallBlindSeat!);
    const bb = this.playerAtSeat(this.bigBlindSeat!);
    if (sb) this.postBlind(sb, this.smallBlind);
    if (bb) this.postBlind(bb, this.bigBlind);
    this.currentBet = this.bigBlind;
    this.minRaise = this.bigBlind;
  }

  private postBlind(player: InternalPlayer, amount: number): void {
    const paid = Math.min(player.stack, amount);
    player.stack -= paid;
    player.bet += paid;
    player.committed += paid;
    if (player.stack === 0) player.allIn = true;
  }

  private beginBetting(): void {
    if (this.livePlayers().length === 1) {
      this.finishUncontested();
      return;
    }

    const canAct = this.players.filter((player) => !player.folded && !player.allIn && player.stack > 0);
    if (canAct.length === 0) {
      this.runoutAndShowdown();
      return;
    }

    // With one player able to act, betting is impossible unless that player
    // still owes chips (e.g. a short blind or all-in raise).
    if (canAct.length === 1) {
      const lone = canAct[0]!;
      if (lone.bet >= this.currentBet) {
        this.runoutAndShowdown();
        return;
      }
    }

    const startAfter = this.street === 'preflop' ? this.bigBlindSeat! : this.buttonSeat;
    const first = this.findNextToAct(startAfter);
    if (first === null) {
      this.completeRound();
      return;
    }
    this.actingSeat = first.seat;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  act(userId: string, action: PlayerAction): EngineState {
    if (this.phase !== 'playing') throw new PokerRuleError('Раздача уже завершена');
    if (this.actingSeat === null) throw new PokerRuleError('Сейчас нет активного хода');

    const player = this.playerAtSeat(this.actingSeat);
    if (!player || player.userId !== userId) throw new PokerRuleError('Сейчас не ваш ход');

    const type = action.type;
    const amount = action.amount;
    let aggressive = false;
    let fullRaise = false;

    switch (type) {
      case 'fold': {
        player.folded = true;
        player.hasActed = true;
        player.canRaise = false;
        player.lastAction = { type, amount: 0 };
        this.lastAction = { seat: player.seat, type, amount: 0 };
        break;
      }
      case 'check': {
        if (this.amountToCall(player) > 0) throw new PokerRuleError('Нельзя чекнуть, когда есть ставка');
        player.hasActed = true;
        player.canRaise = false;
        player.lastAction = { type, amount: 0 };
        this.lastAction = { seat: player.seat, type, amount: 0 };
        break;
      }
      case 'call': {
        const toCall = this.amountToCall(player);
        if (toCall <= 0) throw new PokerRuleError('Нечего коллировать');
        const paid = this.contribute(player, Math.min(toCall, player.stack));
        player.hasActed = true;
        player.canRaise = false;
        player.lastAction = { type, amount: paid };
        this.lastAction = { seat: player.seat, type, amount: paid };
        break;
      }
      case 'bet': {
        if (this.currentBet !== 0) throw new PokerRuleError('Ставка уже открыта — используйте рейз');
        const target = this.requireIntegerAmount(amount);
        const maxTarget = player.stack + player.bet;
        if (target <= 0) throw new PokerRuleError('Ставка должна быть больше нуля');
        if (target > maxTarget) throw new PokerRuleError('Недостаточно фишек');
        if (target < maxTarget && target < this.bigBlind) {
          throw new PokerRuleError(`Минимальная ставка — ${this.bigBlind}`);
        }
        this.contribute(player, target - player.bet);
        this.currentBet = target;
        // A short all-in opening bet does not reduce the minimum raise.
        this.minRaise = target >= this.bigBlind ? target : this.bigBlind;
        aggressive = true;
        fullRaise = true;
        player.hasActed = true;
        player.canRaise = false;
        player.lastAction = { type, amount: target };
        this.lastAction = { seat: player.seat, type, amount: target };
        break;
      }
      case 'raise': {
        if (this.currentBet === 0) throw new PokerRuleError('Сначала нужно сделать ставку');
        if (!player.canRaise) throw new PokerRuleError('Рейз после короткого олл-ина недоступен');
        const target = this.requireIntegerAmount(amount);
        const maxTarget = player.stack + player.bet;
        if (target <= this.currentBet) throw new PokerRuleError('Рейз должен быть больше текущей ставки');
        if (target > maxTarget) throw new PokerRuleError('Недостаточно фишек');
        const increment = target - this.currentBet;
        const allIn = target === maxTarget;
        if (!allIn && increment < this.minRaise) {
          throw new PokerRuleError(`Минимальное повышение — ${this.minRaise}`);
        }
        const paid = this.contribute(player, target - player.bet);
        this.currentBet = target;
        fullRaise = increment >= this.minRaise;
        if (fullRaise) this.minRaise = increment;
        aggressive = true;
        player.hasActed = true;
        player.canRaise = false;
        player.lastAction = { type, amount: paid };
        this.lastAction = { seat: player.seat, type, amount: target };
        break;
      }
      case 'allin': {
        const target = player.stack + player.bet;
        if (target <= 0) throw new PokerRuleError('Нет фишек для олл-ина');
        if (target > this.currentBet) {
          if (this.currentBet > 0 && !player.canRaise) {
            throw new PokerRuleError('Повышение после короткого олл-ина недоступно');
          }
          const openingBet = this.currentBet === 0;
          const increment = target - this.currentBet;
          const paid = this.contribute(player, player.stack);
          this.currentBet = target;
          fullRaise = openingBet || increment >= this.minRaise;
          if (fullRaise) this.minRaise = openingBet ? Math.max(target, this.bigBlind) : increment;
          aggressive = true;
          player.lastAction = { type, amount: paid };
          this.lastAction = { seat: player.seat, type, amount: target };
        } else {
          const paid = this.contribute(player, Math.min(this.amountToCall(player), player.stack));
          player.lastAction = { type, amount: paid };
          this.lastAction = { seat: player.seat, type, amount: paid };
        }
        player.allIn = player.stack === 0;
        player.hasActed = true;
        player.canRaise = false;
        break;
      }
      default: {
        throw new PokerRuleError('Неизвестное действие');
      }
    }

    if (player.stack === 0) player.allIn = true;

    if (aggressive && this.lastAction?.seat === player.seat) {
      if (fullRaise) {
        // A full raise reopens action for everyone else.
        for (const other of this.players) {
          if (other.seat === player.seat || other.folded || other.allIn) continue;
          other.hasActed = false;
          other.canRaise = true;
        }
      }
      // A short all-in raise does not reset hasActed/canRaise. Players who have
      // not acted yet still get their normal turn, but prior actors may only
      // call or fold.
    }

    this.resolveAfterAction(player);
    return this.getState(userId);
  }

  /**
   * Used when a player leaves the table. A fold is legal at any time, including
   * out of turn; the engine then closes the round if necessary.
   */
  forceFold(userId: string): EngineState {
    if (this.phase !== 'playing') return this.getState(userId);
    const player = this.players.find((candidate) => candidate.userId === userId);
    if (!player || player.folded) return this.getState(userId);

    const wasActing = this.actingSeat === player.seat;
    player.folded = true;
    player.hasActed = true;
    player.canRaise = false;

    if (this.livePlayers().length === 1) {
      this.finishUncontested();
      return this.getState(userId);
    }

    if (wasActing) {
      this.resolveAfterAction(player);
    } else if (this.isRoundComplete()) {
      this.completeRound();
    }
    return this.getState(userId);
  }

  /** Server-side clock expiry: check when free, otherwise fold. */
  timeout(userId: string): EngineState {
    const player = this.currentPlayer();
    if (!player || player.userId !== userId) throw new PokerRuleError('Сейчас не ваш ход');
    if (this.amountToCall(player) === 0) return this.act(userId, { type: 'check' });
    return this.act(userId, { type: 'fold' });
  }

  getLegalActions(userId: string): LegalActions | null {
    if (this.phase !== 'playing' || this.actingSeat === null) return null;
    const player = this.playerAtSeat(this.actingSeat);
    if (!player || player.userId !== userId) return null;

    const toCall = this.amountToCall(player);
    const maxTarget = player.stack + player.bet;
    const minRaiseTo = this.currentBet + this.minRaise;
    const canRaise =
      this.currentBet > 0 &&
      player.canRaise &&
      maxTarget > this.currentBet &&
      maxTarget >= minRaiseTo;

    return {
      canFold: true,
      canCheck: toCall === 0,
      canCall: toCall > 0,
      callAmount: Math.min(toCall, player.stack),
      canBet: this.currentBet === 0 && player.stack > 0,
      betMin: Math.min(this.bigBlind, player.stack),
      betMax: player.stack,
      canRaise,
      raiseMin: Math.min(minRaiseTo, maxTarget),
      raiseMax: maxTarget,
      canAllIn: player.stack > 0,
      allInAmount: maxTarget
    };
  }

  getState(viewerId?: string): EngineState {
    const viewer = viewerId ? this.players.find((player) => player.userId === viewerId) : undefined;
    const showdownWinners = new Set(
      this.result?.showdown ? this.result.winners.map((winner) => winner.userId) : []
    );

    return {
      handId: this.handId,
      handNumber: this.handNumber,
      phase: this.phase,
      street: this.street,
      board: cardsToString(this.community),
      pot: this.totalPot(),
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      buttonSeat: this.buttonSeat,
      smallBlindSeat: this.smallBlindSeat,
      bigBlindSeat: this.bigBlindSeat,
      actingSeat: this.actingSeat,
      players: this.players.map((player) => ({
        seat: player.seat,
        userId: player.userId,
        nickname: player.nickname,
        avatarUrl: player.avatarUrl ?? null,
        avatarPreset: player.avatarPreset ?? '🦊',
        stack: player.stack,
        bet: player.bet,
        committed: player.committed,
        folded: player.folded,
        allIn: player.allIn,
        hasActed: player.hasActed,
        isButton: player.seat === this.buttonSeat,
        isSmallBlind: player.seat === this.smallBlindSeat,
        isBigBlind: player.seat === this.bigBlindSeat,
        ...(player.userId === viewerId || showdownWinners.has(player.userId)
          ? { cards: cardsToString(player.holeCards) }
          : {}),
        ...(player.lastAction ? { lastAction: player.lastAction } : {})
      })),
      lastAction: this.lastAction,
      result: this.result,
      you: viewer
        ? {
            seat: viewer.seat,
            holeCards: cardsToString(viewer.holeCards),
            handName: viewer.folded ? null : describeHand([...viewer.holeCards, ...this.community]),
            legalActions: this.getLegalActions(viewerId!)
          }
        : null
    };
  }

  getResult(): HandResult | null {
    return this.result;
  }

  isComplete(): boolean {
    return this.phase === 'complete';
  }

  currentPlayer(): InternalPlayer | null {
    return this.actingSeat === null ? null : (this.playerAtSeat(this.actingSeat) ?? null);
  }

  // ---------------------------------------------------------------------------
  // Betting flow
  // ---------------------------------------------------------------------------

  private resolveAfterAction(actor: InternalPlayer): void {
    if (this.phase !== 'playing') return;

    if (this.livePlayers().length === 1) {
      this.finishUncontested();
      return;
    }

    if (this.isRoundComplete()) {
      this.completeRound();
      return;
    }

    const next = this.findNextToAct(actor.seat);
    if (next === null) {
      // Defensive fallback: never leave a live hand stranded.
      this.completeRound();
      return;
    }
    this.actingSeat = next.seat;
  }

  private isRoundComplete(): boolean {
    const actors = this.players.filter((player) => !player.folded && !player.allIn && player.stack > 0);
    return actors.every((player) => player.hasActed && player.bet === this.currentBet);
  }

  private completeRound(): void {
    if (this.phase !== 'playing') return;
    if (this.street === 'river') {
      this.showdown();
      return;
    }
    this.advanceStreet();
  }

  private advanceStreet(): void {
    const nextStreet: Record<Street, Street | null> = {
      preflop: 'flop',
      flop: 'turn',
      turn: 'river',
      river: null
    };
    const next = nextStreet[this.street];
    if (!next) {
      this.showdown();
      return;
    }

    this.street = next;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.actingSeat = null;
    for (const player of this.players) {
      player.bet = 0;
      player.hasActed = false;
      player.canRaise = true;
    }

    this.burn();
    const cardsToDeal = next === 'flop' ? 3 : 1;
    for (let i = 0; i < cardsToDeal; i += 1) this.community.push(this.draw());

    if (this.livePlayers().length === 1) {
      this.finishUncontested();
      return;
    }

    const canAct = this.players.filter((player) => !player.folded && !player.allIn && player.stack > 0);
    if (canAct.length <= 1) {
      // No further betting is possible; deal the rest and compare hands.
      this.runoutAndShowdown();
      return;
    }

    const first = this.findNextToAct(this.buttonSeat);
    if (first === null) {
      this.runoutAndShowdown();
      return;
    }
    this.actingSeat = first.seat;
  }

  private runoutAndShowdown(): void {
    while (this.street !== 'river') {
      const nextStreet: Record<Street, Street> = {
        preflop: 'flop',
        flop: 'turn',
        turn: 'river',
        river: 'river'
      };
      this.street = nextStreet[this.street];
      this.burn();
      const count = this.street === 'flop' ? 3 : 1;
      for (let i = 0; i < count; i += 1) this.community.push(this.draw());
    }
    this.showdown();
  }

  // ---------------------------------------------------------------------------
  // Pots and settlement
  // ---------------------------------------------------------------------------

  private finishUncontested(): void {
    if (this.phase === 'complete') return;
    const winner = this.livePlayers()[0];
    if (!winner) return;

    const pot = this.totalPot();
    winner.stack += pot;
    winner.payout = pot;
    this.phase = 'complete';
    this.actingSeat = null;

    const board = cardsToString(this.community);
    const participants = this.buildParticipants();
    this.result = {
      handId: this.handId,
      handNumber: this.handNumber,
      tableId: this.tableId,
      board,
      pot,
      startedAt: this.startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      showdown: false,
      winners: [
        {
          seat: winner.seat,
          userId: winner.userId,
          nickname: winner.nickname,
          amount: pot,
          handName: null,
          cards: []
        }
      ],
      participants,
      pots: [{ amount: pot, eligibleSeats: [winner.seat], winners: [{ seat: winner.seat, amount: pot }] }]
    };
  }

  private showdown(): void {
    if (this.phase === 'complete') return;

    // Evaluate every live player's best five-card hand.
    for (const player of this.players) {
      if (!player.folded) {
        player.evaluated = evaluateBest([...player.holeCards, ...this.community]);
      }
    }

    const totalPot = this.totalPot();
    const levels = [...new Set(this.players.filter((p) => p.committed > 0).map((p) => p.committed))].sort(
      (a, b) => a - b
    );

    const pots: HandResult['pots'] = [];
    let previousLevel = 0;

    for (const level of levels) {
      const contributors = this.players.filter((player) => player.committed >= level);
      const amount = (level - previousLevel) * contributors.length;
      previousLevel = level;
      if (amount <= 0) continue;

      let eligible = contributors.filter((player) => !player.folded);
      // This should be impossible in a valid betting sequence, but never lose
      // chips if malformed state somehow reaches showdown.
      if (eligible.length === 0) eligible = this.livePlayers();

      const bestScore = Math.max(...eligible.map((player) => player.evaluated?.score ?? -1));
      const winners = eligible
        .filter((player) => (player.evaluated?.score ?? -1) === bestScore)
        .sort(
          (a, b) =>
            ((a.seat - this.buttonSeat + this.maxSeats) % this.maxSeats) -
            ((b.seat - this.buttonSeat + this.maxSeats) % this.maxSeats)
        );

      const share = Math.floor(amount / winners.length);
      let remainder = amount % winners.length;

      for (const winner of winners) {
        const award = share + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder -= 1;
        winner.stack += award;
        winner.payout += award;
      }

      pots.push({
        amount,
        eligibleSeats: eligible.map((player) => player.seat),
        winners: winners.map((winner) => ({
          seat: winner.seat,
          amount: share + (winners[0] === winner && amount % winners.length > 0 ? 0 : 0)
        }))
      });
    }

    // Build a user-friendly aggregate winner list from actual payouts.
    const winners = this.livePlayers()
      .filter((player) => player.payout > 0)
      .sort((a, b) => b.payout - a.payout)
      .map((player) => ({
        seat: player.seat,
        userId: player.userId,
        nickname: player.nickname,
        amount: player.payout,
        handName: player.evaluated?.name ?? null,
        cards: cardsToString(player.holeCards)
      }));

    this.phase = 'complete';
    this.actingSeat = null;

    this.result = {
      handId: this.handId,
      handNumber: this.handNumber,
      tableId: this.tableId,
      board: cardsToString(this.community),
      pot: totalPot,
      startedAt: this.startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      showdown: true,
      winners,
      participants: this.buildParticipants(),
      pots
    };
  }

  private buildParticipants(): HandResult['participants'] {
    return this.players.map((player) => {
      const net = player.payout - player.committed;
      return {
        userId: player.userId,
        nickname: player.nickname,
        seat: player.seat,
        startingStack: player.startingStack,
        endingStack: player.stack,
        committed: player.committed,
        payout: player.payout,
        folded: player.folded,
        holeCards: cardsToString(player.holeCards).join(' '),
        bestHand: player.evaluated?.name ?? null,
        bestCards: player.evaluated ? cardsToString(player.evaluated.cards) : [],
        result: player.folded ? 'FOLDED' : net > 0 ? 'WON' : 'LOST'
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private livePlayers(): InternalPlayer[] {
    return this.players.filter((player) => !player.folded);
  }

  private totalPot(): number {
    return this.players.reduce((sum, player) => sum + player.committed, 0);
  }

  private amountToCall(player: InternalPlayer): number {
    return Math.max(0, this.currentBet - player.bet);
  }

  private contribute(player: InternalPlayer, amount: number): number {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new PokerRuleError('Некорректная сумма');
    if (amount > player.stack) throw new PokerRuleError('Недостаточно фишек');
    player.stack -= amount;
    player.bet += amount;
    player.committed += amount;
    if (player.stack === 0) player.allIn = true;
    return amount;
  }

  private requireIntegerAmount(amount: number | undefined): number {
    if (amount === undefined || !Number.isSafeInteger(amount)) {
      throw new PokerRuleError('Укажите целую сумму ставки');
    }
    return amount;
  }

  private playerAtSeat(seat: number): InternalPlayer | undefined {
    return this.players.find((player) => player.seat === seat);
  }

  private nextOccupiedSeat(fromSeat: number): number {
    for (let offset = 1; offset <= this.maxSeats; offset += 1) {
      const seat = (fromSeat + offset + this.maxSeats) % this.maxSeats;
      if (this.players.some((player) => player.seat === seat)) return seat;
    }
    return fromSeat;
  }

  private findNextToAct(afterSeat: number): InternalPlayer | null {
    for (let offset = 1; offset <= this.maxSeats; offset += 1) {
      const seat = (afterSeat + offset + this.maxSeats) % this.maxSeats;
      const player = this.playerAtSeat(seat);
      if (
        player &&
        !player.folded &&
        !player.allIn &&
        player.stack > 0 &&
        (!player.hasActed || player.bet < this.currentBet)
      ) {
        return player;
      }
    }
    return null;
  }

  private burn(): void {
    this.deck.shift();
  }

  private draw(): Card {
    const card = this.deck.shift();
    if (!card) throw new PokerRuleError('В колоде закончились карты');
    return card;
  }
}
