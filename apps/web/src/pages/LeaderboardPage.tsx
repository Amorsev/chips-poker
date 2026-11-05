import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import { chips, LEAGUE_COLOR, LEAGUE_LABEL, relativeTime } from '../lib/format';
import type { League, LeaderboardPayload } from '../types';
import { Avatar } from '../components/Avatar';
import { ChipMark } from '../components/Logo';

const PERIODS = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: 'Неделя' },
  { key: 'all', label: 'Всё время' }
] as const;

const LEAGUES: Array<{ key: 'all' | Lowercase<League>; label: string }> = [
  { key: 'all', label: 'Все лиги' },
  { key: 'beginner', label: 'Новичок' },
  { key: 'amateur', label: 'Любитель' },
  { key: 'pro', label: 'Профи' },
  { key: 'highroller', label: 'Хайроллер' }
];

export function LeaderboardPage() {
  const { token } = useAuth();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['key']>('all');
  const [league, setLeague] = useState<(typeof LEAGUES)[number]['key']>('all');
  const [data, setData] = useState<LeaderboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    api<LeaderboardPayload>(`/leaderboard?period=${period}&league=${league}`, {}, token)
      .then((payload) => {
        if (!cancelled) {
          setData(payload);
          setError('');
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Не удалось загрузить рейтинг');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, league, token]);

  const entries = data?.entries ?? [];
  const podium = entries.slice(0, 3);

  return (
    <div className="leaderboard-page">
      <section className="leaderboard-hero">
        <div>
          <p className="eyebrow">Зал славы</p>
          <h1>Лидерборд</h1>
          <p className="muted">
            Топ-100 по выигранным фишкам. Считаются суммы банков, а не текущий баланс.
          </p>
        </div>
        <div className="leaderboard-trophy" aria-hidden="true">
          <span>🏆</span>
          <ChipMark size={54} />
        </div>
      </section>

      <div className="leaderboard-filters">
        <div className="segmented large">
          {PERIODS.map((item) => (
            <button
              key={item.key}
              className={period === item.key ? 'is-active' : ''}
              onClick={() => setPeriod(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="league-tabs">
          {LEAGUES.map((item) => (
            <button
              key={item.key}
              className={league === item.key ? 'is-active' : ''}
              onClick={() => setLeague(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      {loading && !data ? (
        <div className="page-loading">
          <div className="loader-ring" />
          <p>Считаем фишки…</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="empty-state">
          <h2>Пока пусто</h2>
          <p>В этом периоде и лиге ещё никто не выигрывал банки. Станьте первым.</p>
        </div>
      ) : (
        <>
          <section className="podium">
            {[podium[1], podium[0], podium[2]].filter(Boolean).map((entry, displayIndex) => {
              if (!entry) return null;
              const place = entry.rank;
              return (
                <div
                  key={entry.userId}
                  className={`podium-card place-${place} ${entry.isCurrentUser ? 'is-you' : ''}`}
                  style={{ '--league': LEAGUE_COLOR[entry.league] } as React.CSSProperties}
                >
                  <span className="podium-place">{place === 1 ? '👑' : place}</span>
                  <Avatar
                    avatarUrl={entry.avatarUrl}
                    preset={entry.avatarPreset}
                    size={place === 1 ? 78 : 64}
                    ring={place === 1 ? '#f2cd7a' : LEAGUE_COLOR[entry.league]}
                  />
                  <b>{entry.nickname}</b>
                  <span className="podium-league">{LEAGUE_LABEL[entry.league]}</span>
                  <strong>{chips(entry.score)}</strong>
                  <small>{entry.hands} раздач</small>
                  <span className="podium-bar" style={{ height: `${42 + (3 - Math.min(displayIndex, 3)) * 10}px` }} />
                </div>
              );
            })}
          </section>

          <section className="leaderboard-table panel">
            <div className="leaderboard-table-head">
              <span>#</span>
              <span>Игрок</span>
              <span>Лига</span>
              <span>Раздач</span>
              <span>Выиграно</span>
            </div>
            {entries.map((entry) => (
              <div
                key={entry.userId}
                className={`leaderboard-row ${entry.isCurrentUser ? 'is-you' : ''}`}
              >
                <span className="rank">{entry.rank}</span>
                <span className="leader-player">
                  <Avatar
                    avatarUrl={entry.avatarUrl}
                    preset={entry.avatarPreset}
                    size={38}
                    ring={LEAGUE_COLOR[entry.league]}
                  />
                  <b>{entry.nickname}</b>
                  {entry.isCurrentUser && <em>вы</em>}
                </span>
                <span>
                  <span className="league-tag" style={{ color: LEAGUE_COLOR[entry.league] }}>
                    {LEAGUE_LABEL[entry.league]}
                  </span>
                </span>
                <span className="muted">{entry.hands}</span>
                <strong className="leader-score">
                  <ChipMark size={17} />
                  {chips(entry.score)}
                </strong>
              </div>
            ))}
          </section>
        </>
      )}

      <p className="leaderboard-footnote">
        {data ? `Обновлено ${relativeTime(data.generatedAt)} · кэш до 45 секунд` : 'Рейтинг обновляется автоматически'}
      </p>
    </div>
  );
}
