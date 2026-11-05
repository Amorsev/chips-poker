import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/middleware.js';
import { getLeaderboard } from './service.js';

export const leaderboardRouter = Router();
leaderboardRouter.use(authenticate);

const querySchema = z.object({
  period: z.enum(['all', 'week', 'today']).default('all'),
  league: z.enum(['all', 'beginner', 'amateur', 'pro', 'highroller']).default('all')
});

leaderboardRouter.get('/', async (req, res) => {
  const query = querySchema.parse(req.query);
  const league = query.league === 'all' ? undefined : query.league.toUpperCase();
  const entries = await getLeaderboard(query.period, league);
  res.json({
    period: query.period,
    league: query.league,
    entries: entries.map((entry) => ({
      ...entry,
      isCurrentUser: entry.userId === req.authUser.id
    })),
    generatedAt: new Date().toISOString()
  });
});
