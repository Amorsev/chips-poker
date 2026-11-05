import { EventEmitter } from 'node:events';
import type { HandResult, PlayerAction } from './engine.js';
import { PokerRuleError } from './engine.js';
import { TABLE_CONFIGS, type TableConfig } from './tables.js';
import { TableRuntime, type ChatMessage, type TablePlayer } from './table-runtime.js';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { invalidateCache } from '../cache.js';
import { withWriteRetry } from '../utils/retry.js';
import type { User } from '@prisma/client';

interface ManagerEvents {
  tableState: [table: TableRuntime];
  chat: [table: TableRuntime, message: ChatMessage];
  wallet: [userId: string, chips: number];
}

export interface SeatResult {
  table: TableRuntime;
  player: TablePlayer;
  buyIn: number;
  chipsAfter: number;
  freeTopUp: number;
}

/**
 * Owns all live tables, seat allocation and wallet movements. Wallet mutations
 * are serializable DB transactions; table state is kept in memory for low
 * latency. On startup `recoverTableStakes` returns any stake that was debited
 * but never cashed out, so a crash cannot permanently strand a bankroll.
 */
export class TableManager extends EventEmitter<ManagerEvents> {
  private readonly tables = new Map<string, TableRuntime>();
  private readonly userTables = new Map<string, string>();
  // React StrictMode and reconnect races can emit table:join twice. Wallet
  // debits are serializable, so without this guard both requests could buy in
  // before either one recorded the seat. Coalesce concurrent joins per user.
  private readonly seating = new Map<string, Promise<SeatResult>>();

  constructor() {
    super();
    for (const definition of TABLE_CONFIGS) {
      const runtime = new TableRuntime(definition, config.TURN_TIMEOUT_MS, config.NEXT_HAND_DELAY_MS, config.CHAT_HISTORY_LIMIT);
      runtime.on('state', (table) => this.emit('tableState', table));
      runtime.on('chat', (table, message) => this.emit('chat', table, message));
      runtime.on('handCompleted', (table, result) => {
        void this.persistHand(table, result);
      });
      runtime.on('cashout', (table, userId, amount) => {
        void this.cashOut(table, userId, amount);
      });
      this.tables.set(definition.id, runtime);
    }
  }

  listTables(): TableRuntime[] {
    return [...this.tables.values()];
  }

  getTable(tableId: string): TableRuntime {
    const table = this.tables.get(tableId);
    if (!table) throw new PokerRuleError('Стол не найден');
    return table;
  }

  tableForUser(userId: string): TableRuntime | null {
    const id = this.userTables.get(userId);
    return id ? this.tables.get(id) ?? null : null;
  }

  /**
   * Buy-ins leave the bankroll immediately, while the resulting stack lives in
   * memory. A crashed session therefore leaves a run of TABLE_BUY_IN rows after
   * the user's last TABLE_CASH_OUT. Refund exactly that run. Looking at the
   * trailing run (rather than the all-time net) avoids mixing in profit or loss
   * from earlier, properly closed sessions.
   */
  async recoverTableStakes(): Promise<void> {
    if (!config.RECOVER_TABLE_STAKES) return;

    const stranded = await prisma.$queryRaw<Array<{ userId: string; outstanding: bigint }>>`
      SELECT b."userId" AS "userId", SUM(-b.amount)::bigint AS "outstanding"
      FROM "ChipTransaction" b
      WHERE b.type = 'TABLE_BUY_IN'::"TransactionType"
        AND b."createdAt" > COALESCE(
          (
            SELECT MAX(c."createdAt")
            FROM "ChipTransaction" c
            WHERE c."userId" = b."userId"
              AND c.type = 'TABLE_CASH_OUT'::"TransactionType"
          ),
          TIMESTAMP '1970-01-01 00:00:00'
        )
      GROUP BY b."userId"
      HAVING SUM(-b.amount) > 0
    `;

    if (stranded.length === 0) return;

    for (const row of stranded) {
      const refund = row.outstanding;
      try {
        await withWriteRetry(() =>
          prisma.$transaction(async (tx) => {
            const updated = await tx.user.update({
              where: { id: row.userId },
              data: { chips: { increment: refund } }
            });
            await tx.chipTransaction.create({
              data: {
                userId: row.userId,
                type: 'TABLE_CASH_OUT',
                amount: refund,
                balanceAfter: updated.chips,
                reference: 'startup-recovery',
                metadata: { reason: 'stranded_table_stake_recovery' }
              }
            });
          })
        );
        logger.warn(
          { userId: row.userId, refund: Number(refund) },
          'Recovered a stranded table stake after restart'
        );
      } catch (error) {
        logger.error({ err: error, userId: row.userId }, 'Failed to recover a stranded table stake');
      }
    }
  }

  async seatUser(
    user: User,
    tableId: string,
    requestedBuyIn?: number,
    preferredSeat?: number
  ): Promise<SeatResult> {
    const pending = this.seating.get(user.id);
    if (pending) {
      const result = await pending;
      if (result.table.config.id !== tableId) {
        throw new PokerRuleError('Сначала выйдите из-за текущего стола');
      }
      // The in-flight request already debited the wallet and seated the player.
      return { ...result, buyIn: 0, freeTopUp: 0 };
    }

    const task = this.seatUserInner(user, tableId, requestedBuyIn, preferredSeat);
    this.seating.set(user.id, task);
    try {
      return await task;
    } finally {
      if (this.seating.get(user.id) === task) this.seating.delete(user.id);
    }
  }

  private async seatUserInner(
    user: User,
    tableId: string,
    requestedBuyIn?: number,
    preferredSeat?: number
  ): Promise<SeatResult> {
    const table = this.getTable(tableId);
    if (this.userTables.has(user.id)) {
      throw new PokerRuleError('Вы уже сидите за игровым столом. Сначала выйдите из-за него.');
    }
    if (!this.hasLeagueAccess(user, table.config)) {
      throw new PokerRuleError(
        `Для лиги «${table.config.league}» нужно выиграть больше ${table.config.minTotalWon.toLocaleString('ru-RU')} фишек`
      );
    }
    if (table.seatedPlayers().length >= table.config.maxSeats) {
      throw new PokerRuleError('Все места за столом заняты');
    }

    // Validate seat availability before moving money.
    if (
      preferredSeat !== undefined &&
      (preferredSeat < 0 ||
        preferredSeat >= table.config.maxSeats ||
        table.seatedPlayers().some((player) => player.seat === preferredSeat))
    ) {
      preferredSeat = undefined;
    }

    const wallet = await this.buyIn(user.id, table.config, requestedBuyIn);
    let player: TablePlayer;
    try {
      player = table.addPlayer(
        {
          userId: user.id,
          nickname: user.nickname,
          avatarUrl: user.avatarUrl,
          avatarPreset: user.avatarPreset
        },
        wallet.buyIn,
        preferredSeat
      );
    } catch (error) {
      // Race: the seat was taken while the wallet transaction was running.
      await this.cashOut(table, user.id, wallet.buyIn).catch(() => undefined);
      throw error;
    }

    this.userTables.set(user.id, table.config.id);
    this.emit('wallet', user.id, wallet.chipsAfter);
    invalidateCache('leaderboard:').catch(() => undefined);
    return { table, player, buyIn: wallet.buyIn, chipsAfter: wallet.chipsAfter, freeTopUp: wallet.freeTopUp };
  }

  async rebuy(user: User, amount?: number): Promise<SeatResult> {
    const table = this.tableForUser(user.id);
    if (!table) throw new PokerRuleError('Вы не сидите за столом');
    const player = table.playerByUserId(user.id);
    if (!player) throw new PokerRuleError('Вы не сидите за столом');
    if (player.stack > 0) throw new PokerRuleError('Пополнение доступно только при нулевом стеке');

    const wallet = await this.buyIn(user.id, table.config, amount);
    try {
      table.addChips(user.id, wallet.buyIn);
    } catch (error) {
      await this.cashOut(table, user.id, wallet.buyIn).catch(() => undefined);
      throw error;
    }
    this.emit('wallet', user.id, wallet.chipsAfter);
    return { table, player, buyIn: wallet.buyIn, chipsAfter: wallet.chipsAfter, freeTopUp: wallet.freeTopUp };
  }

  leave(userId: string): { table: TableRuntime; removed: boolean } {
    const table = this.tableForUser(userId);
    if (!table) throw new PokerRuleError('Вы не сидите за столом');
    const result = table.requestLeave(userId);
    if (result.removed) this.userTables.delete(userId);
    return { table, removed: result.removed };
  }

  action(userId: string, action: PlayerAction): void {
    const table = this.tableForUser(userId);
    if (!table) throw new PokerRuleError('Вы не сидите за столом');
    table.act(userId, action);
  }

  chat(userId: string, text: string): ChatMessage {
    const table = this.tableForUser(userId);
    if (!table) throw new PokerRuleError('Вы не сидите за столом');
    return table.chat(userId, text);
  }

  setSittingOut(userId: string, sittingOut: boolean): void {
    const table = this.tableForUser(userId);
    if (!table) throw new PokerRuleError('Вы не сидите за столом');
    table.setSittingOut(userId, sittingOut);
  }

  connect(userId: string): void {
    const table = this.userTables.get(userId);
    if (table) this.getTable(table).setConnected(userId, true);
  }

  disconnect(userId: string): void {
    const table = this.userTables.get(userId);
    if (table) this.getTable(table).setConnected(userId, false);
  }

  hasLeagueAccess(user: Pick<User, 'totalWon'>, table: TableConfig): boolean {
    return table.minTotalWon === 0 ? true : user.totalWon > BigInt(table.minTotalWon);
  }

  // ---------------------------------------------------------------------------
  // Ledger
  // ---------------------------------------------------------------------------

  /**
   * Debits a table buy-in from the wallet. If the wallet is below the table
   * minimum, a free top-up to the minimum is issued first. There is no endpoint
   * that grants chips outside this path, and chips can never be purchased.
   */
  private async buyIn(
    userId: string,
    table: TableConfig,
    requestedBuyIn?: number
  ): Promise<{ buyIn: number; chipsAfter: number; freeTopUp: number }> {
    return withWriteRetry(() =>
      prisma.$transaction(
        async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) throw new PokerRuleError('Пользователь не найден');

        const min = BigInt(table.minBuyIn);
        const max = BigInt(table.maxBuyIn);
        let balance = user.chips;
        let freeTopUp = 0n;

        if (balance < min) {
          freeTopUp = min - balance;
          balance += freeTopUp;
          await tx.user.update({ where: { id: userId }, data: { chips: { increment: freeTopUp } } });
          await tx.chipTransaction.create({
            data: {
              userId,
              type: 'FREE_TOP_UP',
              amount: freeTopUp,
              balanceAfter: balance,
              reference: table.id,
              metadata: { reason: 'free_stack_below_table_minimum', tableId: table.id }
            }
          });
        }

        const desired = BigInt(
          Math.max(
            table.minBuyIn,
            Math.min(
              requestedBuyIn && Number.isSafeInteger(requestedBuyIn) ? requestedBuyIn : table.minBuyIn,
              table.maxBuyIn
            )
          )
        );
        const buyIn = desired > balance ? balance : desired;
        if (buyIn < min) {
          // Should be unreachable because of the top-up above.
          throw new PokerRuleError('Недостаточно фишек для входа за стол');
        }

        const after = balance - buyIn;
        await tx.user.update({ where: { id: userId }, data: { chips: after } });
        await tx.chipTransaction.create({
          data: {
            userId,
            type: 'TABLE_BUY_IN',
            amount: -buyIn,
            balanceAfter: after,
            reference: table.id,
            metadata: { tableId: table.id, buyIn: buyIn.toString() }
          }
        });

        return { buyIn: Number(buyIn), chipsAfter: Number(after), freeTopUp: Number(freeTopUp) };
        },
        { isolationLevel: 'Serializable' }
      )
    );
  }

  private async cashOut(table: TableRuntime, userId: string, amount: number): Promise<void> {
    if (amount < 0) {
      logger.error({ userId, amount, tableId: table.config.id }, 'Ignoring negative cash-out');
      return;
    }
    try {
      const user = await withWriteRetry(() =>
        prisma.$transaction(
          async (tx) => {
            // A zero cash-out still writes a row: it closes the session so startup
            // recovery knows the buy-in was not stranded by a crash.
            const updated =
              amount > 0
                ? await tx.user.update({
                    where: { id: userId },
                    data: { chips: { increment: BigInt(amount) } }
                  })
                : await tx.user.findUniqueOrThrow({ where: { id: userId } });
            await tx.chipTransaction.create({
              data: {
                userId,
                type: 'TABLE_CASH_OUT',
                amount: BigInt(amount),
                balanceAfter: updated.chips,
                reference: table.config.id,
                metadata: { tableId: table.config.id }
              }
            });
            return updated;
          },
          { isolationLevel: 'Serializable' }
        )
      );
      if (this.userTables.get(userId) === table.config.id) this.userTables.delete(userId);
      if (amount > 0) this.emit('wallet', userId, Number(user.chips));
    } catch (error) {
      logger.error({ err: error, userId, amount, tableId: table.config.id }, 'Cash-out failed; chips remain at risk');
    }
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private async persistHand(table: TableRuntime, result: HandResult): Promise<void> {
    try {
      await withWriteRetry(() =>
        prisma.$transaction(async (tx) => {
        await tx.hand.create({
          data: {
            id: result.handId,
            tableId: table.config.id,
            tableName: table.config.name,
            league: table.config.league,
            handNumber: result.handNumber,
            board: result.board.join(' '),
            pot: BigInt(result.pot),
            startedAt: new Date(result.startedAt),
            endedAt: new Date(result.endedAt),
            participants: {
              create: result.participants.map((participant) => {
                const loss = Math.max(0, participant.committed - participant.payout);
                return {
                  userId: participant.userId,
                  seat: participant.seat,
                  startingStack: BigInt(participant.startingStack),
                  endingStack: BigInt(participant.endingStack),
                  committed: BigInt(participant.committed),
                  wonAmount: BigInt(participant.payout),
                  netAmount: BigInt(participant.payout - participant.committed),
                  folded: participant.folded,
                  holeCards: participant.holeCards,
                  bestHand: participant.bestHand,
                  result: participant.folded ? 'FOLDED' : participant.payout > 0 ? 'WON' : 'LOST',
                  playedAt: new Date(result.endedAt)
                };
              })
            }
          }
        });

        for (const participant of result.participants) {
          const loss = Math.max(0, participant.committed - participant.payout);
          await tx.user.update({
            where: { id: participant.userId },
            data: {
              handsPlayed: { increment: 1 },
              handsWon: { increment: participant.payout > 0 ? 1 : 0 },
              totalWon: { increment: BigInt(participant.payout) },
              totalLost: { increment: BigInt(loss) },
              lastSeenAt: new Date()
            }
          });
        }
        })
      );
      await invalidateCache('leaderboard:');
    } catch (error) {
      logger.error({ err: error, handId: result.handId, tableId: table.config.id }, 'Failed to persist hand');
    }
  }
}

export const tableManager = new TableManager();
