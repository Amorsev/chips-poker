import { Router } from 'express';
import { authenticate } from '../auth/middleware.js';
import { tableManager } from '../game/table-manager.js';
import { LEAGUES, leagueForTotalWon } from '../utils/serialize.js';

export const lobbyRouter = Router();
lobbyRouter.use(authenticate);

function serializeTable(table: ReturnType<typeof tableManager.listTables>[number], userTotalWon: bigint) {
  const info = table.getLobbyInfo();
  const unlocked = info.minTotalWon === 0 ? true : userTotalWon > BigInt(info.minTotalWon);
  return { ...info, unlocked };
}

lobbyRouter.get('/tables', (req, res) => {
  const currentTable = tableManager.tableForUser(req.authUser.id);
  const tables = tableManager
    .listTables()
    .map((table) => serializeTable(table, req.authUser.totalWon));

  res.json({
    leagues: LEAGUES.map((league) => ({
      ...league,
      unlocked: league.minTotalWon === 0 ? true : req.authUser.totalWon > BigInt(league.minTotalWon)
    })),
    tables,
    currentTableId: currentTable?.config.id ?? null,
    yourLeague: leagueForTotalWon(req.authUser.totalWon),
    yourTotalWon: Number(req.authUser.totalWon),
    generatedAt: new Date().toISOString()
  });
});

lobbyRouter.get('/tables/:id', (req, res) => {
  const table = tableManager.getTable(req.params.id);
  res.json({ table: serializeTable(table, req.authUser.totalWon) });
});
