import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  HoldemEngine,
  PokerRuleError,
  type ActionType,
  type EngineState,
  type HandResult,
  type PlayerAction
} from './engine.js';
import type { TableConfig } from './tables.js';

export interface TablePlayer {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  avatarPreset: string;
  seat: number;
  stack: number;
  sittingOut: boolean;
  pendingLeave: boolean;
  connections: number;
  joinedAt: number;
}

export interface ChatMessage {
  id: string;
  userId: string;
  nickname: string;
  text: string;
  at: string;
}

export interface PublicTableState {
  revision: number;
  table: TableConfig;
  phase: 'waiting' | 'playing' | 'complete';
  handId: string | null;
  handNumber: number;
  street: string | null;
  board: string[];
  pot: number;
  currentBet: number;
  minRaise: number;
  buttonSeat: number | null;
  smallBlindSeat: number | null;
  bigBlindSeat: number | null;
  actingSeat: number | null;
  actionDeadline: string | null;
  turnTimeoutMs: number;
  nextHandAt: string | null;
  players: Array<{
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
    status: 'active' | 'folded' | 'all-in' | 'waiting' | 'sitting-out' | 'disconnected';
    connected: boolean;
    pendingLeave: boolean;
    cards?: string[];
    lastAction?: { type: ActionType; amount: number };
  }>;
  you: {
    seated: boolean;
    seat: number | null;
    holeCards: string[];
    handName: string | null;
    legalActions: ReturnType<HoldemEngine['getLegalActions']>;
  } | null;
  lastResult: {
    handId: string;
    handNumber: number;
    board: string[];
    pot: number;
    showdown: boolean;
    winners: HandResult['winners'];
  } | null;
}

type TableEvents = {
  state: [table: TableRuntime];
  handCompleted: [table: TableRuntime, result: HandResult];
  cashout: [table: TableRuntime, userId: string, amount: number];
  chat: [table: TableRuntime, message: ChatMessage];
};

/**
 * Holds the live, authoritative state of one table. A table always runs on one
 * process; see ARCHITECTURE.md for the ownership strategy when scaling out.
 */
export class TableRuntime extends EventEmitter<TableEvents> {
  readonly config: TableConfig;
  private readonly seats: Array<TablePlayer | null>;
  private engine: HoldemEngine | null = null;
  private handNumber = 0;
  private previousButtonSeat: number | null = null;
  private lastResult: HandResult | null = null;
  private actionDeadline: number | null = null;
  private nextHandAt: number | null = null;
  private turnTimer: NodeJS.Timeout | null = null;
  private startTimer: NodeJS.Timeout | null = null;
  private settledHandId: string | null = null;
  private revision = 0;
  private readonly chatHistory: ChatMessage[] = [];

  constructor(
    config: TableConfig,
    private readonly turnTimeoutMs: number,
    private readonly nextHandDelayMs: number,
    private readonly chatHistoryLimit: number
  ) {
    super();
    this.config = config;
    this.seats = Array.from({ length: config.maxSeats }, () => null);
  }

  // ---------------------------------------------------------------------------
  // Seating
  // ---------------------------------------------------------------------------

  addPlayer(
    profile: { userId: string; nickname: string; avatarUrl: string | null; avatarPreset: string },
    stack: number,
    preferredSeat?: number
  ): TablePlayer {
    if (this.seats.some((seat) => seat?.userId === profile.userId)) {
      throw new PokerRuleError('Вы уже сидите за этим столом');
    }
    if (this.seats.every((seat) => seat !== null)) {
      throw new PokerRuleError('За столом нет свободных мест');
    }

    let seat = preferredSeat;
    if (seat === undefined || seat < 0 || seat >= this.config.maxSeats || this.seats[seat] !== null) {
      seat = this.seats.findIndex((candidate) => candidate === null);
    }
    if (seat < 0) throw new PokerRuleError('За столом нет свободных мест');

    const player: TablePlayer = {
      ...profile,
      seat,
      stack,
      sittingOut: false,
      pendingLeave: false,
      connections: 0,
      joinedAt: Date.now()
    };
    this.seats[seat] = player;
    this.emitState();
    this.scheduleNextHand();
    return player;
  }

  /** Add chips (a paid buy-in or a free rebuy) while the player is not in a hand. */
  addChips(userId: string, amount: number): TablePlayer {
    const player = this.playerByUserId(userId);
    if (!player) throw new PokerRuleError('Вы не сидите за этим столом');
    const inHand = this.engineInHand().some((participant) => participant.userId === userId);
    if (inHand && this.engine?.getState().phase === 'playing') {
      throw new PokerRuleError('Пополнение возможно после завершения текущей раздачи');
    }
    if (player.stack + amount > this.config.maxBuyIn) {
      throw new PokerRuleError(`Максимальный стек за столом — ${this.config.maxBuyIn}`);
    }
    player.stack += amount;
    this.emitState();
    this.scheduleNextHand();
    return player;
  }

  setConnected(userId: string, connected: boolean): void {
    const player = this.playerByUserId(userId);
    if (!player) return;
    player.connections = Math.max(0, player.connections + (connected ? 1 : -1));
    this.emitState();
  }

  setSittingOut(userId: string, sittingOut: boolean): void {
    const player = this.playerByUserId(userId);
    if (!player) throw new PokerRuleError('Вы не сидите за этим столом');
    if (this.engine?.getState().phase === 'playing' && this.engineInHand().some((p) => p.userId === userId)) {
      throw new PokerRuleError('Нельзя изменить статус во время раздачи');
    }
    player.sittingOut = sittingOut;
    this.emitState();
    this.scheduleNextHand();
  }

  /**
   * Returns the stack to the bankroll once the player is fully out of a hand.
   * While a hand is running, the player is folded and removed at settlement.
   */
  requestLeave(userId: string): { removed: boolean } {
    const player = this.playerByUserId(userId);
    if (!player) throw new PokerRuleError('Вы не сидите за этим столом');

    const inHand = this.engineInHand().some((participant) => participant.userId === userId);
    const playing = this.engine?.getState().phase === 'playing';

    if (inHand && playing) {
      player.pendingLeave = true;
      try {
        this.engine!.forceFold(userId);
      } catch {
        // The hand may have completed simultaneously (for example with a
        // disconnect during the last action). Settlement below still runs.
      }
      this.afterEngineAction();
      return { removed: false };
    }

    this.removePlayer(player);
    return { removed: true };
  }

  /** Called by the manager only after the wallet transaction has succeeded. */
  kickWithoutCashout(userId: string): void {
    const player = this.playerByUserId(userId);
    if (player) this.removePlayer(player, true);
  }

  private removePlayer(player: TablePlayer, skipCashout = false): void {
    this.seats[player.seat] = null;
    this.emitState();
    if (!skipCashout && player.stack > 0) {
      this.emit('cashout', this, player.userId, player.stack);
    }
    this.scheduleNextHand();
  }

  // ---------------------------------------------------------------------------
  // Hand lifecycle
  // ---------------------------------------------------------------------------

  private scheduleNextHand(delay = this.nextHandDelayMs): void {
    if (this.startTimer || this.engine?.getState().phase === 'playing') return;
    const eligible = this.eligiblePlayers();
    if (eligible.length < 2) {
      this.nextHandAt = null;
      return;
    }
    if (this.nextHandAt && this.nextHandAt > Date.now() + delay) return;
    this.nextHandAt = Date.now() + delay;
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      this.startHand();
    }, delay);
  }

  private startHand(): void {
    this.clearTurnTimer();
    const eligible = this.eligiblePlayers();
    if (eligible.length < 2) {
      this.nextHandAt = null;
      this.emitState();
      return;
    }

    this.handNumber += 1;
    this.lastResult = null;
    this.settledHandId = null;
    this.nextHandAt = null;

    try {
      this.engine = new HoldemEngine({
        tableId: this.config.id,
        tableName: this.config.name,
        league: this.config.league,
        maxSeats: this.config.maxSeats,
        smallBlind: this.config.smallBlind,
        bigBlind: this.config.bigBlind,
        handNumber: this.handNumber,
        previousButtonSeat: this.previousButtonSeat,
        players: eligible.map((player) => ({
          userId: player.userId,
          nickname: player.nickname,
          avatarUrl: player.avatarUrl,
          avatarPreset: player.avatarPreset,
          seat: player.seat,
          stack: player.stack
        }))
      });
      this.previousButtonSeat = this.engine.getState().buttonSeat;
    } catch {
      this.engine = null;
      this.scheduleNextHand();
      return;
    }

    this.emitState();

    if (this.engine.isComplete()) {
      this.settleHand();
      return;
    }
    this.scheduleTurn();
  }

  act(userId: string, action: PlayerAction): void {
    if (!this.engine) throw new PokerRuleError('Раздача ещё не началась');
    this.engine.act(userId, action);
    this.afterEngineAction();
  }

  private afterEngineAction(): void {
    if (!this.engine) return;
    if (this.engine.isComplete()) {
      this.settleHand();
      return;
    }
    this.scheduleTurn();
  }

  private scheduleTurn(): void {
    this.clearTurnTimer();
    if (!this.engine || this.engine.isComplete()) return;
    const player = this.engine.currentPlayer();
    if (!player) return;

    const handId = this.engine.handId;
    const userId = player.userId;
    this.actionDeadline = Date.now() + this.turnTimeoutMs;
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      if (!this.engine || this.engine.handId !== handId || this.engine.currentPlayer()?.userId !== userId) return;
      try {
        this.engine.timeout(userId);
        this.afterEngineAction();
      } catch {
        // A racing action from the player may have consumed the turn.
      }
    }, this.turnTimeoutMs);

    this.emitState();
  }

  private settleHand(): void {
    if (!this.engine) return;
    const result = this.engine.getResult();
    if (!result || this.settledHandId === result.handId) return;
    this.settledHandId = result.handId;
    this.clearTurnTimer();

    // Copy stacks won/lost during the hand back to the seating layer.
    for (const participant of result.participants) {
      const player = this.playerByUserId(participant.userId);
      if (player) player.stack = participant.endingStack;
    }

    this.lastResult = result;
    this.actionDeadline = null;
    this.nextHandAt = Date.now() + this.nextHandDelayMs;

    // Persist asynchronously. The live table must not block on PostgreSQL.
    this.emit('handCompleted', this, result);

    // Players who asked to leave while involved in the hand are cashed out now.
    for (const player of this.seats) {
      if (player?.pendingLeave) this.removePlayer(player);
    }

    this.emitState();
    if (this.eligiblePlayers().length >= 2) this.scheduleNextHand();
    else this.nextHandAt = null;
  }

  /** Revision guards clients against out-of-order socket broadcasts. */
  private emitState(): void {
    this.revision += 1;
    this.emit('state', this);
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  private eligiblePlayers(): TablePlayer[] {
    return this.seats.filter(
      (player): player is TablePlayer => Boolean(player && player.stack > 0 && !player.sittingOut)
    );
  }

  private engineInHand(): Array<{ userId: string }> {
    if (!this.engine) return [];
    return this.engine.getState().players.map((player) => ({ userId: player.userId }));
  }

  // ---------------------------------------------------------------------------
  // Chat / state
  // ---------------------------------------------------------------------------

  chat(userId: string, rawText: string): ChatMessage {
    const player = this.playerByUserId(userId);
    if (!player) throw new PokerRuleError('Только игроки за столом могут писать в чат');
    const text = rawText
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    if (!text) throw new PokerRuleError('Пустое сообщение');

    const message: ChatMessage = {
      id: randomUUID(),
      userId,
      nickname: player.nickname,
      text,
      at: new Date().toISOString()
    };
    this.chatHistory.push(message);
    if (this.chatHistory.length > this.chatHistoryLimit) this.chatHistory.shift();
    this.emit('chat', this, message);
    return message;
  }

  getChatHistory(): ChatMessage[] {
    return [...this.chatHistory];
  }

  playerByUserId(userId: string): TablePlayer | null {
    return this.seats.find((player) => player?.userId === userId) ?? null;
  }

  seatedPlayers(): TablePlayer[] {
    return this.seats.filter((player): player is TablePlayer => player !== null);
  }

  getState(viewerId?: string): PublicTableState {
    const engineState: EngineState | null = this.engine?.getState(viewerId) ?? null;
    const engineBySeat = new Map(engineState?.players.map((player) => [player.seat, player]) ?? []);

    const players = this.seats
      .filter((player): player is TablePlayer => player !== null)
      .map((roster) => {
        const live = engineBySeat.get(roster.seat);
        const status: PublicTableState['players'][number]['status'] = roster.pendingLeave
          ? 'waiting'
          : roster.sittingOut
            ? 'sitting-out'
            : roster.connections === 0
              ? 'disconnected'
              : live?.folded
                ? 'folded'
                : live?.allIn
                  ? 'all-in'
                  : live
                    ? 'active'
                    : 'waiting';

        return {
          seat: roster.seat,
          userId: roster.userId,
          nickname: roster.nickname,
          avatarUrl: roster.avatarUrl,
          avatarPreset: roster.avatarPreset,
          stack: live?.stack ?? roster.stack,
          bet: live?.bet ?? 0,
          committed: live?.committed ?? 0,
          folded: live?.folded ?? false,
          allIn: live?.allIn ?? roster.stack === 0,
          hasActed: live?.hasActed ?? false,
          isButton: live?.isButton ?? false,
          isSmallBlind: live?.isSmallBlind ?? false,
          isBigBlind: live?.isBigBlind ?? false,
          status,
          connected: roster.connections > 0,
          pendingLeave: roster.pendingLeave,
          ...(live?.cards ? { cards: live.cards } : {}),
          ...(live?.lastAction ? { lastAction: live.lastAction } : {})
        };
      })
      .sort((a, b) => a.seat - b.seat);

    const viewer = viewerId ? this.playerByUserId(viewerId) : null;
    const you = viewer
      ? {
          seated: true,
          seat: viewer.seat,
          holeCards: engineState?.you?.holeCards ?? [],
          handName: engineState?.you?.handName ?? null,
          legalActions: engineState?.you?.legalActions ?? null
        }
      : null;

    return {
      revision: this.revision,
      table: this.config,
      phase: engineState?.phase ?? 'waiting',
      handId: engineState?.handId ?? null,
      handNumber: engineState?.handNumber ?? this.handNumber,
      street: engineState?.street ?? null,
      board: engineState?.board ?? [],
      pot: engineState?.pot ?? 0,
      currentBet: engineState?.currentBet ?? 0,
      minRaise: engineState?.minRaise ?? this.config.bigBlind,
      buttonSeat: engineState?.buttonSeat ?? null,
      smallBlindSeat: engineState?.smallBlindSeat ?? null,
      bigBlindSeat: engineState?.bigBlindSeat ?? null,
      actingSeat: engineState?.actingSeat ?? null,
      actionDeadline: this.actionDeadline ? new Date(this.actionDeadline).toISOString() : null,
      turnTimeoutMs: this.turnTimeoutMs,
      nextHandAt: this.nextHandAt ? new Date(this.nextHandAt).toISOString() : null,
      players,
      you,
      lastResult: this.lastResult
        ? {
            handId: this.lastResult.handId,
            handNumber: this.lastResult.handNumber,
            board: this.lastResult.board,
            pot: this.lastResult.pot,
            showdown: this.lastResult.showdown,
            winners: this.lastResult.winners
          }
        : null
    };
  }

  getLobbyInfo() {
    const seated = this.seatedPlayers();
    const stacks = seated.map((player) => player.stack);
    return {
      id: this.config.id,
      name: this.config.name,
      league: this.config.league,
      maxSeats: this.config.maxSeats,
      smallBlind: this.config.smallBlind,
      bigBlind: this.config.bigBlind,
      minBuyIn: this.config.minBuyIn,
      maxBuyIn: this.config.maxBuyIn,
      minTotalWon: this.config.minTotalWon,
      activePlayers: seated.length,
      averageStack:
        stacks.length > 0 ? Math.round(stacks.reduce((sum, value) => sum + value, 0) / stacks.length) : 0,
      phase: this.engine?.getState().phase ?? 'waiting',
      nextHandAt: this.nextHandAt ? new Date(this.nextHandAt).toISOString() : null
    };
  }

  dispose(): void {
    this.clearTurnTimer();
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
  }
}
