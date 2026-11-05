import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import type { User } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { verifyAccessToken } from '../auth/tokens.js';
import { AppError } from '../errors.js';
import { tableManager } from '../game/table-manager.js';
import { PokerRuleError } from '../game/engine.js';

interface SocketData {
  user: User;
  joinedTableId: string | null;
  chatTimes: number[];
}

type Ack = (response: { ok: true; [key: string]: unknown } | { ok: false; error: string }) => void;

const joinSchema = z.object({
  tableId: z.string().min(1).max(64),
  buyIn: z.number().int().positive().optional(),
  seat: z.number().int().min(0).max(8).optional()
});

const actionSchema = z.object({
  type: z.enum(['fold', 'check', 'call', 'bet', 'raise', 'allin']),
  amount: z.number().int().positive().optional()
});

const chatSchema = z.object({ text: z.string().min(1).max(200) });
const rebuySchema = z.object({ amount: z.number().int().positive().optional() });

function room(tableId: string): string {
  return `table:${tableId}`;
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof AppError || error instanceof PokerRuleError) return error.message;
  if (error instanceof z.ZodError) return 'Некорректные данные команды';
  return 'Не удалось выполнить действие';
}

function ackError(ack: Ack | undefined, error: unknown): void {
  if (error instanceof z.ZodError) {
    ack?.({ ok: false, error: 'Некорректные данные' });
    return;
  }
  ack?.({ ok: false, error: errorMessage(error) });
}

/**
 * Socket.IO is the transport only. All game rules are enforced by the table
 * engine; no chip amount is trusted from the browser.
 */
export async function initSocket(io: Server): Promise<void> {
  io.use(async (socket, next) => {
    try {
      const token =
        (typeof socket.handshake.auth?.token === 'string' && socket.handshake.auth.token) ||
        (typeof socket.handshake.headers.authorization === 'string' &&
        socket.handshake.headers.authorization.startsWith('Bearer ')
          ? socket.handshake.headers.authorization.slice(7)
          : null);

      if (!token) return next(new Error('UNAUTHORIZED'));
      const payload = verifyAccessToken(token);
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || user.tokenVersion !== payload.ver) return next(new Error('UNAUTHORIZED'));

      const data = socket.data as SocketData;
      data.user = user;
      data.joinedTableId = null;
      data.chatTimes = [];
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const data = socket.data as SocketData;
    const user = data.user;
    void socket.join(userRoom(user.id));

    // Reconnect support: if the user is still seated, put this socket back in
    // the table room and send a fresh personalised state.
    const existingTable = tableManager.tableForUser(user.id);
    if (existingTable) {
      void joinTableRoom(socket, existingTable.config.id);
    }

    socket.on('table:join', async (payload, ack: Ack) => {
      try {
        const body = joinSchema.parse(payload);
        const current = tableManager.tableForUser(user.id);
        if (current && current.config.id !== body.tableId) {
          throw new PokerRuleError('Сначала выйдите из-за текущего стола');
        }

        // Joining the table you are already seated at is idempotent. This makes
        // reconnect/navigation races harmless and never charges a second buy-in.
        if (current && current.config.id === body.tableId) {
          await joinTableRoom(socket, body.tableId);
          ack?.({ ok: true, buyIn: 0, chipsAfter: Number(user.chips), freeTopUp: 0 });
          return;
        }

        const result = await tableManager.seatUser(user, body.tableId, body.buyIn, body.seat);
        await joinTableRoom(socket, body.tableId);
        ack?.({
          ok: true,
          buyIn: result.buyIn,
          chipsAfter: result.chipsAfter,
          freeTopUp: result.freeTopUp
        });
      } catch (error) {
        logger.warn({ err: error, userId: user.id, event: 'table:join' }, 'Socket action rejected');
        ackError(ack, error);
        socket.emit('table:error', { message: errorMessage(error) });
      }
    });

    socket.on('table:leave', (ack: Ack) => {
      try {
        const result = tableManager.leave(user.id);
        if (result.removed) {
          void leaveTableRoom(socket, result.table.config.id);
          socket.emit('table:left', { tableId: result.table.config.id });
        } else {
          socket.emit('table:info', { message: 'Вы выйдете из-за стола после завершения раздачи' });
        }
        ack?.({ ok: true, removed: result.removed });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on('table:action', (payload, ack: Ack) => {
      try {
        const body = actionSchema.parse(payload);
        tableManager.action(user.id, body);
        ack?.({ ok: true });
      } catch (error) {
        ackError(ack, error);
        // The seat can disappear if the API restarted and the client is still
        // showing an old table. Send it back to the lobby instead of leaving a
        // dead table on screen.
        if (!tableManager.tableForUser(user.id)) {
          socket.emit('table:left', { tableId: data.joinedTableId ?? '' });
          return;
        }
        socket.emit('table:error', { message: errorMessage(error) });
      }
    });

    socket.on('table:chat', (payload, ack: Ack) => {
      try {
        const now = Date.now();
        data.chatTimes = data.chatTimes.filter((time) => now - time < 5_000);
        if (data.chatTimes.length >= 5) throw new PokerRuleError('Слишком часто. Подождите немного.');
        const body = chatSchema.parse(payload);
        tableManager.chat(user.id, body.text);
        data.chatTimes.push(now);
        ack?.({ ok: true });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on('table:rebuy', async (payload, ack: Ack) => {
      try {
        const body = rebuySchema.parse(payload ?? {});
        const result = await tableManager.rebuy(user, body.amount);
        ack?.({ ok: true, buyIn: result.buyIn, chipsAfter: result.chipsAfter, freeTopUp: result.freeTopUp });
      } catch (error) {
        ackError(ack, error);
        socket.emit('table:error', { message: errorMessage(error) });
      }
    });

    socket.on('table:sitout', (payload, ack: Ack) => {
      try {
        const body = z.object({ sittingOut: z.boolean() }).parse(payload);
        tableManager.setSittingOut(user.id, body.sittingOut);
        ack?.({ ok: true });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on('disconnect', () => {
      if (data.joinedTableId) {
        tableManager.disconnect(user.id);
        data.joinedTableId = null;
      }
    });

    async function joinTableRoom(target: Socket, tableId: string): Promise<void> {
      if (target.data.joinedTableId === tableId) {
        target.emit('table:state', tableManager.getTable(tableId).getState(user.id));
        return;
      }
      if (target.data.joinedTableId) {
        await target.leave(room(target.data.joinedTableId));
        tableManager.disconnect(user.id);
      }
      await target.join(room(tableId));
      target.data.joinedTableId = tableId;
      tableManager.connect(user.id);

      const table = tableManager.getTable(tableId);
      target.emit('table:state', table.getState(user.id));
      target.emit('table:chat:history', table.getChatHistory());
    }
  });

  tableManager.on('tableState', (table) => {
    void broadcastTable(io, table.config.id);
  });

  tableManager.on('chat', (table, message) => {
    io.to(room(table.config.id)).emit('table:chat', message);
  });

  tableManager.on('wallet', (userId, chips) => {
    io.to(userRoom(userId)).emit('wallet:update', { chips });
  });
}

async function broadcastTable(io: Server, tableId: string): Promise<void> {
  try {
    const sockets = await io.in(room(tableId)).fetchSockets();
    const table = tableManager.getTable(tableId);
    for (const socket of sockets) {
      const data = socket.data as SocketData;
      socket.emit('table:state', table.getState(data.user?.id));
    }
  } catch (error) {
    logger.warn({ err: error, tableId }, 'Failed to broadcast table state');
  }
}

async function leaveTableRoom(socket: Socket, tableId: string): Promise<void> {
  await socket.leave(room(tableId));
  const data = socket.data as SocketData;
  if (data.joinedTableId === tableId) {
    data.joinedTableId = null;
    tableManager.disconnect(data.user.id);
  }
}
