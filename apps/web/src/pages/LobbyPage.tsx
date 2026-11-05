import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import { chips, compactChips, LEAGUE_COLOR, LEAGUE_LABEL } from '../lib/format';
import type { League, LobbyPayload, LobbyTable } from '../types';
import { ChipMark } from '../components/Logo';
import { Modal } from '../components/Modal';
import { useToast } from '../context/ToastContext';

export function LobbyPage() {
  const { token, user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<LobbyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [league, setLeague] = useState<'ALL' | League>('ALL');
  const [seats, setSeats] = useState<'ALL' | 6 | 9>('ALL');
  const [selected, setSelected] = useState<LobbyTable | null>(null);
  const [buyIn, setBuyIn] = useState(0);
  const [joining, setJoining] = useState(false);
  const requestRef = useRef(false);

  const load = useCallback(async () => {
    if (!token || requestRef.current) return;
    requestRef.current = true;
    try {
      const payload = await api<LobbyPayload>('/lobby/tables', {}, token);
      setData(payload);
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось загрузить лобби');
    } finally {
      requestRef.current = false;
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 8_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const tables = useMemo(() => {
    if (!data) return [];
    return data.tables.filter(
      (table) =>
        (league === 'ALL' || table.league === league) &&
        (seats === 'ALL' || table.maxSeats === seats)
    );
  }, [data, league, seats]);

  const nextLeague = useMemo(() => {
    if (!data || !user) return null;
    return data.leagues.find(
      (item) => item.key !== data.yourLeague && item.minTotalWon >= user.totalWon
    ) ?? null;
  }, [data, user]);

  // The player can never buy in for more than their bankroll. Percent buttons
  // are relative to this effective maximum, not just the table maximum.
  const maxBuyInAmount = useMemo(() => {
    if (!selected || !user) return 0;
    const step = selected.bigBlind;
    const affordable = Math.floor(Math.max(0, user.chips) / step) * step;
    return Math.max(selected.minBuyIn, Math.min(selected.maxBuyIn, affordable));
  }, [selected, user]);

  useEffect(() => {
    if (!selected) return;
    setBuyIn((value) => Math.min(maxBuyInAmount, Math.max(selected.minBuyIn, value)));
  }, [selected, maxBuyInAmount]);

  function quickBuyIn(fraction: number): number {
    if (!selected) return 0;
    const rounded = Math.round((maxBuyInAmount * fraction) / selected.bigBlind) * selected.bigBlind;
    return Math.min(maxBuyInAmount, Math.max(selected.minBuyIn, rounded));
  }

  function openBuyIn(table: LobbyTable) {
    if (!table.unlocked) {
      toast.show(`Нужно выиграть больше ${chips(table.minTotalWon)} фишек за всё время`, 'error');
      return;
    }
    if (data?.currentTableId === table.id) {
      navigate(`/table/${table.id}`);
      return;
    }
    setSelected(table);
    setBuyIn(table.minBuyIn);
  }

  function confirmSeat() {
    if (!selected) return;
    const amount = Math.min(maxBuyInAmount, Math.max(selected.minBuyIn, buyIn));
    setJoining(true);
    navigate(`/table/${selected.id}?buyIn=${amount}`);
    setJoining(false);
  }

  if (loading && !data) {
    return (
      <div className="page-loading">
        <div className="loader-ring" />
        <p>Собираем столы…</p>
      </div>
    );
  }

  return (
    <div className="lobby">
      <section className="lobby-hero">
        <div className="lobby-hero-copy">
          <p className="eyebrow">Ваш игровой вечер</p>
          <h1>
            Привет, <span>{user?.nickname}</span>
          </h1>
          <p className="muted">
            Выберите лигу и стол. Не хватает фишек? Мы бесплатно поставим минимальный стек —
            без покупок и обязательств.
          </p>
          <div className="hero-actions">
            <button
              className="primary-button"
              onClick={() => {
                const beginner = data?.tables.find((table) => table.league === 'BEGINNER');
                if (beginner) openBuyIn(beginner);
              }}
            >
              Быстрый старт
            </button>
            <button className="secondary-button" onClick={() => void load()}>
              Обновить лобби
            </button>
          </div>
        </div>

        <div className="bankroll-card">
          <div className="bankroll-top">
            <span>Ваш банкролл</span>
            <ChipMark size={28} />
          </div>
          <strong>{chips(user?.chips ?? 0)}</strong>
          <div className="bankroll-meta">
            <span>
              Выиграно <b className="positive">+{compactChips(user?.totalWon ?? 0)}</b>
            </span>
            <span>
              Раздач <b>{user?.handsPlayed ?? 0}</b>
            </span>
          </div>
          <div className="league-progress">
            <div className="league-progress-head">
              <span>{data?.yourLeague ? LEAGUE_LABEL[data.yourLeague] : 'Новичок'}</span>
              {nextLeague && <span>до {nextLeague.name}: {chips(nextLeague.minTotalWon - (user?.totalWon ?? 0) + 1)}</span>}
            </div>
            <div className="progress-track">
              <span
                style={{
                  width: `${
                    nextLeague
                      ? Math.min(
                          100,
                          Math.max(
                            4,
                            ((user?.totalWon ?? 0) /
                              Math.max(1, nextLeague.minTotalWon + 1)) *
                              100
                          )
                        )
                      : 100
                  }%`
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {error && <div className="form-error lobby-error">{error}</div>}

      <section className="section-block">
        <div className="section-head">
          <div>
            <p className="eyebrow">Лиги</p>
            <h2>Найдите свой уровень</h2>
          </div>
          <span className="muted small">Доступ открывается за общий выигрыш</span>
        </div>
        <div className="league-grid">
          {data?.leagues.map((item) => {
            const active = league === item.key;
            return (
              <button
                key={item.key}
                className={`league-card ${active ? 'is-active' : ''} ${item.unlocked ? '' : 'is-locked'}`}
                onClick={() => setLeague(active ? 'ALL' : item.key)}
                style={{ '--league': item.color } as React.CSSProperties}
              >
                <span className="league-top">
                  <span className="league-dot" />
                  {item.name}
                  {!item.unlocked && <span className="lock">🔒</span>}
                </span>
                <span className="league-blinds">
                  {item.smallBlind}/{item.bigBlind}
                </span>
                <span className="league-req">
                  {item.minTotalWon === 0 ? 'Доступ всем' : `> ${chips(item.minTotalWon)} выиграно`}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="section-block">
        <div className="section-head tables-head">
          <div>
            <p className="eyebrow">Кэш-игры</p>
            <h2>Открытые столы</h2>
          </div>
          <div className="filter-row">
            <div className="segmented">
              {(['ALL', 6, 9] as const).map((value) => (
                <button
                  key={String(value)}
                  className={seats === value ? 'is-active' : ''}
                  onClick={() => setSeats(value)}
                >
                  {value === 'ALL' ? 'Все' : `${value}-max`}
                </button>
              ))}
            </div>
            <span className="live-dot">LIVE</span>
          </div>
        </div>

        {tables.length === 0 ? (
          <div className="empty-state">Для выбранных фильтров столов нет.</div>
        ) : (
          <div className="tables-grid">
            {tables.map((table) => (
              <article
                key={table.id}
                className={`table-card ${table.unlocked ? '' : 'is-locked'} ${
                  data?.currentTableId === table.id ? 'is-current' : ''
                }`}
                style={{ '--league': LEAGUE_COLOR[table.league] } as React.CSSProperties}
              >
                <div className="table-card-head">
                  <span className="table-league">{LEAGUE_LABEL[table.league]}</span>
                  <span className={`table-status status-${table.phase}`}>
                    {table.phase === 'playing' ? 'Идёт игра' : table.phase === 'complete' ? 'Раздача' : 'Ждёт игроков'}
                  </span>
                </div>
                <h3>{table.name}</h3>
                <div className="table-stakes">
                  <div>
                    <span>Блайнды</span>
                    <b>
                      {table.smallBlind}/{table.bigBlind}
                    </b>
                  </div>
                  <div>
                    <span>Игроки</span>
                    <b>
                      {table.activePlayers}<em>/{table.maxSeats}</em>
                    </b>
                  </div>
                  <div>
                    <span>Средний стек</span>
                    <b>{table.averageStack ? compactChips(table.averageStack) : '—'}</b>
                  </div>
                </div>
                <div className="seat-meter">
                  {Array.from({ length: table.maxSeats }).map((_, index) => (
                    <span key={index} className={index < table.activePlayers ? 'filled' : ''} />
                  ))}
                </div>
                <div className="buyin-line">
                  <span>Вход</span>
                  <b>
                    {chips(table.minBuyIn)}–{chips(table.maxBuyIn)}
                  </b>
                </div>
                {!table.unlocked && (
                  <div className="unlock-hint">
                    🔒 Нужно выиграть &gt; {chips(table.minTotalWon)}
                  </div>
                )}
                <button
                  className={data?.currentTableId === table.id ? 'secondary-button wide' : 'primary-button wide'}
                  onClick={() => openBuyIn(table)}
                >
                  {data?.currentTableId === table.id
                    ? 'Вернуться за стол'
                    : table.unlocked
                      ? 'Сесть за стол'
                      : 'Закрыто'}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="responsible-banner">
        <ChipMark size={36} />
        <div>
          <b>Только игра, без денег.</b>
          <span>
            Фишки выдаются бесплатно, не имеют стоимости и не могут быть куплены, проданы или
            выведены. Мы не принимаем платежи за игру.
          </span>
        </div>
      </section>

      <Modal
        open={Boolean(selected)}
        title={selected ? `Вход за стол · ${selected.name}` : 'Вход за стол'}
        onClose={() => setSelected(null)}
        footer={
          <>
            <button className="ghost-button" onClick={() => setSelected(null)}>
              Отмена
            </button>
            <button className="primary-button" onClick={confirmSeat} disabled={joining || !selected}>
              {joining ? 'Садимся…' : 'Сесть и играть'}
            </button>
          </>
        }
      >
        {selected && user && (
          <div className="buyin-modal">
            <div className="buyin-summary">
              <div>
                <span>Блайнды</span>
                <b>
                  {selected.smallBlind}/{selected.bigBlind}
                </b>
              </div>
              <div>
                <span>Ваш баланс</span>
                <b>{chips(user.chips)}</b>
              </div>
              <div>
                <span>Свободные места</span>
                <b>{selected.maxSeats - selected.activePlayers}</b>
              </div>
            </div>

            <label className="buyin-label">
              <span>Сумма входа</span>
              <strong>{chips(buyIn)}</strong>
            </label>
            <input
              type="range"
              min={selected.minBuyIn}
              max={maxBuyInAmount}
              step={selected.bigBlind}
              value={buyIn}
              onChange={(event) => setBuyIn(Number(event.target.value))}
              className="slider"
            />
            <div className="slider-labels">
              <span>{chips(selected.minBuyIn)}</span>
              <span>{chips(maxBuyInAmount)}</span>
            </div>

            {user.chips >= selected.minBuyIn && user.chips < selected.maxBuyIn && (
              <p className="muted small">
                Максимум входа ограничен балансом: {chips(maxBuyInAmount)}. Проценты считаются
                от доступной суммы.
              </p>
            )}

            {user.chips < selected.minBuyIn ? (
              <div className="free-stack-note">
                <b>Бесплатный стек</b>
                <span>
                  На балансе меньше минимума. Сервер бесплатно добавит {chips(selected.minBuyIn - user.chips)}{' '}
                  фишек до минимального входа.
                </span>
              </div>
            ) : (
              <p className="muted small">
                Фишки перейдут со счёта на стек за столом. При выходе остаток вернётся на баланс.
                Покупка фишек невозможна.
              </p>
            )}

            <div className="quick-buyins">
              {[0.25, 0.5, 1].map((fraction) => {
                const value = quickBuyIn(fraction);
                return (
                  <button
                    key={fraction}
                    className={buyIn === value ? 'is-active' : ''}
                    onClick={() => setBuyIn(value)}
                  >
                    {Math.round(fraction * 100)}%
                  </button>
                );
              })}
            </div>
            <button
              className="text-button"
              onClick={async () => {
                await refreshProfile();
                toast.show('Баланс обновлён');
              }}
            >
              Обновить баланс
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
