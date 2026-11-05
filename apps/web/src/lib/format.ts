const formatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

export function chips(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '0';
  return formatter.format(Math.round(value));
}

export function compactChips(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  return chips(value);
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export function cardLabel(card: string): { rank: string; suit: string } {
  const suit = card.slice(-1);
  const rank = card.slice(0, -1);
  return { rank, suit };
}

export function isRedSuit(card: string): boolean {
  return card.endsWith('h') || card.endsWith('d');
}

export const SUIT_SYMBOL: Record<string, string> = {
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣'
};

export const LEAGUE_LABEL: Record<string, string> = {
  BEGINNER: 'Новичок',
  AMATEUR: 'Любитель',
  PRO: 'Профи',
  HIGHROLLER: 'Хайроллер'
};

export const LEAGUE_COLOR: Record<string, string> = {
  BEGINNER: '#48d6a4',
  AMATEUR: '#5aa9ff',
  PRO: '#c084fc',
  HIGHROLLER: '#f5b544'
};

export const ACTION_LABEL: Record<string, string> = {
  fold: 'Фолд',
  check: 'Чек',
  call: 'Колл',
  bet: 'Бет',
  raise: 'Рейз',
  allin: 'Олл-ин'
};

export const TX_LABEL: Record<string, string> = {
  WELCOME_BONUS: 'Приветственный бонус',
  FREE_TOP_UP: 'Бесплатный стек',
  TABLE_BUY_IN: 'Вход за стол',
  TABLE_CASH_OUT: 'Выход из-за стола',
  ADMIN_ADJUSTMENT: 'Корректировка'
};
