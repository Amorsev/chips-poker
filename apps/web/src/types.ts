export type League = 'BEGINNER' | 'AMATEUR' | 'PRO' | 'HIGHROLLER';

export interface User {
  id: string;
  email: string;
  nickname: string;
  avatarUrl: string | null;
  avatarPreset: string;
  chips: number;
  totalWon: number;
  totalLost: number;
  handsPlayed: number;
  handsWon: number;
  winRate: number;
  league: League;
  welcomeBonusClaimed: boolean;
  createdAt: string;
}

export interface RecentHand {
  id: string;
  tableName: string;
  league: League;
  board: string[];
  holeCards: string[];
  pot: number;
  wonAmount: number;
  netAmount: number;
  result: 'WON' | 'LOST' | 'FOLDED';
  folded: boolean;
  bestHand: string | null;
  playedAt: string;
}

export interface Transaction {
  id: string;
  type: 'WELCOME_BONUS' | 'FREE_TOP_UP' | 'TABLE_BUY_IN' | 'TABLE_CASH_OUT' | 'ADMIN_ADJUSTMENT';
  amount: number;
  balanceAfter: number;
  createdAt: string;
}

export interface ProfilePayload {
  user: User;
  avatarPresets: string[];
  recentHands: RecentHand[];
  transactions: Transaction[];
}

export interface LeagueInfo {
  key: League;
  name: string;
  minTotalWon: number;
  smallBlind: number;
  bigBlind: number;
  color: string;
  unlocked: boolean;
}

export interface LobbyTable {
  id: string;
  name: string;
  league: League;
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  minTotalWon: number;
  activePlayers: number;
  averageStack: number;
  phase: 'playing' | 'complete' | 'waiting';
  nextHandAt: string | null;
  unlocked: boolean;
}

export interface LobbyPayload {
  leagues: LeagueInfo[];
  tables: LobbyTable[];
  currentTableId: string | null;
  yourLeague: League;
  yourTotalWon: number;
  generatedAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  avatarPreset: string;
  score: number;
  hands: number;
  league: League;
  isCurrentUser?: boolean;
}

export interface LeaderboardPayload {
  period: 'all' | 'week' | 'today';
  league: 'all' | Lowercase<League>;
  entries: LeaderboardEntry[];
  generatedAt: string;
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

export interface TablePlayerState {
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
  lastAction?: { type: string; amount: number };
}

export interface TableState {
  revision: number;
  table: {
    id: string;
    name: string;
    league: League;
    maxSeats: number;
    smallBlind: number;
    bigBlind: number;
    minBuyIn: number;
    maxBuyIn: number;
    minTotalWon: number;
  };
  phase: 'waiting' | 'playing' | 'complete';
  handId: string | null;
  handNumber: number;
  street: 'preflop' | 'flop' | 'turn' | 'river' | null;
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
  players: TablePlayerState[];
  you: {
    seated: boolean;
    seat: number | null;
    holeCards: string[];
    handName: string | null;
    legalActions: LegalActions | null;
  } | null;
  lastResult: {
    handId: string;
    handNumber: number;
    board: string[];
    pot: number;
    showdown: boolean;
    winners: Array<{
      seat: number;
      userId: string;
      nickname: string;
      amount: number;
      handName: string | null;
      cards: string[];
    }>;
  } | null;
}

export interface ChatMessage {
  id: string;
  userId: string;
  nickname: string;
  text: string;
  at: string;
}
