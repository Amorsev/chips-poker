import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getSocket } from '../lib/socket';
import { ACTION_LABEL, chips, compactChips, LEAGUE_COLOR, LEAGUE_LABEL } from '../lib/format';
import type { ChatMessage, TablePlayerState, TableState } from '../types';
import { Avatar } from '../components/Avatar';
import { ChipMark } from '../components/Logo';
import { PlayingCard, CardRow } from '../components/PlayingCard';

function seatPosition(seat: number, selfSeat: number | null, maxSeats: number): CSSProperties {
  const relative = selfSeat === null ? seat : (seat - selfSeat + maxSeats) % maxSeats;
  const angle = ((90 + relative * (360 / maxSeats)) * Math.PI) / 180;
  return {
    left: `${50 + 43 * Math.cos(angle)}%`,
    top: `${50 + 41 * Math.sin(angle)}%`
  };
}

function statusLabel(player: TablePlayerState): string | null {
  if (player.status === 'folded') return 'Фолд';
  if (player.status === 'all-in') return 'Олл-ин';
  if (player.status === 'sitting-out') return 'Сидит вне игры';
  if (player.status === 'disconnected') return 'Не в сети';
  if (player.status === 'waiting') return 'Ждёт';
  return null;
}

export function TablePage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { token, user, refreshProfile } = useAuth();
  const toast = useToast();

  const buyInFromUrl = Number(params.get('buyIn')) || undefined;
  const [state, setState] = useState<TableState | null>(null);
  const [joinError, setJoinError] = useState('');
  const [socketReady, setSocketReady] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [raiseTo, setRaiseTo] = useState(0);
  const [now, setNow] = useState(Date.now());
  const socketRef = useRef<Socket | null>(null);
  const wasSeated = useRef(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const self = useMemo(
    () => (state?.you?.seat != null ? state.players.find((player) => player.seat === state.you!.seat) : null),
    [state]
  );
  const legal = state?.you?.legalActions ?? null;
  const isMyTurn = Boolean(
    state?.phase === 'playing' && legal && state.you?.seat === state.actingSeat
  );

  const aggressiveMin = legal?.canBet ? legal.betMin : legal?.canRaise ? legal.raiseMin : 0;
  const aggressiveMax = legal?.canBet ? legal.betMax : legal?.canRaise ? legal.raiseMax : 0;
  const canAggress = Boolean(legal && (legal.canBet || legal.canRaise));

  useEffect(() => {
    if (!canAggress) return;
    setRaiseTo((value) => Math.min(aggressiveMax, Math.max(aggressiveMin, value || aggressiveMin)));
  }, [canAggress, aggressiveMin, aggressiveMax]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!token || !id) return;
    const socket = getSocket(token);
    socketRef.current = socket;

    // Re-run on every reconnect: the API keeps seats in memory, so after a
    // server restart the session must re-join (the server refunded the old
    // stack during startup recovery). Joining a table the user still occupies
    // is idempotent and never charges a second buy-in.
    const join = () => {
      setSocketReady(true);
      socket.emit(
        'table:join',
        { tableId: id, ...(buyInFromUrl ? { buyIn: buyInFromUrl } : {}) },
        (response: { ok: boolean; error?: string }) => {
          if (!response.ok) {
            setJoinError(response.error ?? 'Не удалось сесть за стол');
            setState(null);
          }
        }
      );
    };

    const onConnect = () => {
      setJoinError('');
      // Table revisions restart from zero with the API process. Drop the old
      // state so the fresh state from the re-join is not rejected as stale.
      setState(null);
      join();
    };
    const onDisconnect = () => {
      setSocketReady(false);
      // Do not leave live action buttons on a dead socket: their events would
      // be buffered and could reach the server before the re-join.
      setState(null);
    };
    const onState = (next: TableState) => {
      setState((previous) => (!previous || next.revision >= previous.revision ? next : previous));
    };
    const onHistory = (messages: ChatMessage[]) => setChat(messages);
    const onChat = (message: ChatMessage) => setChat((messages) => [...messages.slice(-79), message]);
    const onError = (payload: { message: string }) => toast.show(payload.message, 'error');
    const onInfo = (payload: { message: string }) => toast.show(payload.message, 'info');
    const onLeft = () => {
      setState(null);
      void refreshProfile();
      navigate('/lobby');
    };
    const onWallet = () => void refreshProfile();
    const onConnectError = () => setJoinError('Соединение отклонено. Обновите страницу или войдите снова.');

    if (socket.connected) join();
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('table:state', onState);
    socket.on('table:chat:history', onHistory);
    socket.on('table:chat', onChat);
    socket.on('table:error', onError);
    socket.on('table:info', onInfo);
    socket.on('table:left', onLeft);
    socket.on('wallet:update', onWallet);
    socket.on('connect_error', onConnectError);

    return () => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
      socket.off('disconnect', onDisconnect);
      socket.off('table:state', onState);
      socket.off('table:chat:history', onHistory);
      socket.off('table:chat', onChat);
      socket.off('table:error', onError);
      socket.off('table:info', onInfo);
      socket.off('table:left', onLeft);
      socket.off('wallet:update', onWallet);
    };
  }, [token, id, buyInFromUrl, navigate, refreshProfile, toast]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [chat, chatOpen]);

  // A leave requested during a hand is deferred by the server. Once settlement
  // removes the seat, `you` becomes null; return to the lobby and refresh the
  // bankroll (the stack has just been cashed out).
  useEffect(() => {
    if (!state) return;
    if (state.you?.seated) {
      wasSeated.current = true;
      return;
    }
    if (!wasSeated.current) return;
    wasSeated.current = false;
    void refreshProfile();
    navigate('/lobby');
  }, [state, navigate, refreshProfile]);

  const turnSeconds = state ? Math.round(state.turnTimeoutMs / 1_000) : 20;
  const remaining = state?.actionDeadline
    ? Math.max(0, (new Date(state.actionDeadline).getTime() - now) / 1000)
    : 0;
  const nextHandIn = state?.nextHandAt
    ? Math.max(0, Math.ceil((new Date(state.nextHandAt).getTime() - now) / 1000))
    : 0;

  const sendAction = useCallback(
    (type: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin', amount?: number) => {
      const socket = socketRef.current;
      if (!socket || submitting) return;
      setSubmitting(true);
      socket.emit('table:action', { type, ...(amount ? { amount } : {}) }, (response: { ok: boolean; error?: string }) => {
        setSubmitting(false);
        if (!response.ok) toast.show(response.error ?? 'Действие отклонено', 'error');
      });
    },
    [submitting, toast]
  );

  function sendChat(event: FormEvent) {
    event.preventDefault();
    const socket = socketRef.current;
    const text = chatText.trim();
    if (!socket || !text) return;
    socket.emit('table:chat', { text }, (response: { ok: boolean; error?: string }) => {
      if (!response.ok) toast.show(response.error ?? 'Сообщение не отправлено', 'error');
    });
    setChatText('');
  }

  function leaveTable() {
    const socket = socketRef.current;
    if (!socket) return;
    if (!window.confirm('Покинуть стол? Остаток стека вернётся на баланс.')) return;
    socket.emit('table:leave', (response: { ok: boolean; removed?: boolean; error?: string }) => {
      if (!response.ok) {
        toast.show(response.error ?? 'Не удалось выйти', 'error');
        return;
      }
      if (response.removed) {
        void refreshProfile();
        navigate('/lobby');
      }
    });
  }

  function rebuy() {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit(
      'table:rebuy',
      { amount: state?.table.minBuyIn },
      (response: { ok: boolean; error?: string; buyIn?: number; freeTopUp?: number }) => {
        if (!response.ok) {
          toast.show(response.error ?? 'Не удалось пополнить стек', 'error');
          return;
        }
        toast.show(
          response.freeTopUp
            ? 'Начислен бесплатный стек. Приятной игры!'
            : `Стек пополнен на ${chips(response.buyIn ?? 0)}`,
          'success'
        );
        void refreshProfile();
      }
    );
  }

  if (joinError && !state) {
    return (
      <div className="table-error-page">
        <div className="empty-state">
          <h2>Не удалось сесть за стол</h2>
          <p>{joinError}</p>
          <button className="primary-button" onClick={() => navigate('/lobby')}>
            Вернуться в лобби
          </button>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="page-loading">
        <div className="loader-ring" />
        <p>{socketReady ? 'Раздаём карты…' : 'Подключаемся к столу…'}</p>
      </div>
    );
  }

  const tableColor = LEAGUE_COLOR[state.table.league];
  const selfSeat = state.you?.seat ?? null;
  const boardSlots = 5;
  const hasResult = state.phase === 'complete' && state.lastResult;

  return (
    <div className="table-page">
      <div className="table-toolbar">
        <button className="ghost-button" onClick={() => navigate('/lobby')}>
          ← Лобби
        </button>
        <div className="table-title">
          <span className="table-league-pill" style={{ borderColor: tableColor, color: tableColor }}>
            {LEAGUE_LABEL[state.table.league]}
          </span>
          <h1>{state.table.name}</h1>
          <span className="muted small">
            Блайнды {state.table.smallBlind}/{state.table.bigBlind} · Раздача #{state.handNumber}
          </span>
        </div>
        <div className="table-toolbar-actions">
          <button className="secondary-button compact" onClick={() => setChatOpen((open) => !open)}>
            Чат {chat.length > 0 && <em>{chat.length}</em>}
          </button>
          <button className="ghost-button danger" onClick={leaveTable}>
            Покинуть стол
          </button>
        </div>
      </div>

      <div className={`table-layout ${chatOpen ? 'chat-visible' : ''}`}>
        <section className="poker-stage">
          {state.phase === 'playing' && state.actionDeadline && (
            <div className="turn-timer">
              <span style={{ width: `${Math.min(100, (remaining / turnSeconds) * 100)}%` }} />
              <b>{Math.ceil(remaining)}</b>
            </div>
          )}

          <div className="poker-table-wrap">
            <div className="poker-table" style={{ '--league-color': tableColor } as CSSProperties}>
              <div className="felt-ring" />
              <div className="felt-center">
                <div className="pot-display">
                  <ChipMark size={20} />
                  <span>Банк</span>
                  <b>{chips(state.pot)}</b>
                </div>

                <div className="board-row">
                  {Array.from({ length: boardSlots }).map((_, index) => {
                    const card = state.board[index];
                    return card ? (
                      <PlayingCard key={`${card}-${index}`} card={card} delay={index * 70} />
                    ) : (
                      <div key={`slot-${index}`} className="card-slot" />
                    );
                  })}
                </div>

                <div className="street-label">
                  {state.phase === 'waiting'
                    ? 'Ожидание игроков'
                    : state.phase === 'complete'
                      ? 'Раздача завершена'
                      : state.street === 'preflop'
                        ? 'Префлоп'
                        : state.street === 'flop'
                          ? 'Флоп'
                          : state.street === 'turn'
                            ? 'Тёрн'
                            : 'Ривер'}
                  {state.phase === 'playing' && state.currentBet > 0 && (
                    <span> · ставка {chips(state.currentBet)}</span>
                  )}
                </div>

                <div className="felt-watermark">
                  <ChipMark size={44} />
                  <span>CHIPS</span>
                </div>
              </div>

              {state.players.map((player) => (
                <TableSeat
                  key={player.seat}
                  player={player}
                  self={selfSeat === player.seat}
                  acting={state.actingSeat === player.seat}
                  position={seatPosition(player.seat, selfSeat, state.table.maxSeats)}
                  remaining={state.actingSeat === player.seat ? remaining : 0}
                  turnSeconds={turnSeconds}
                  color={tableColor}
                />
              ))}

              {state.players.length < 2 && state.phase === 'waiting' && (
                <div className="waiting-banner">
                  <span className="pulse-dot" />
                  Ждём второго игрока. Пригласите друга или подождите.
                </div>
              )}

              {hasResult && (
                <div className="result-overlay">
                  <p className="eyebrow">{state.lastResult!.showdown ? 'Шоудаун' : 'Банк без вскрытия'}</p>
                  <div className="result-winners">
                    {state.lastResult!.winners.map((winner) => (
                      <div key={winner.userId} className="result-winner">
                        <div>
                          <b>{winner.nickname}</b>
                          <span>
                            {winner.handName ?? 'Забрал банк'} · +{chips(winner.amount)}
                          </span>
                        </div>
                        {winner.cards.length > 0 && <CardRow cards={winner.cards} small />}
                      </div>
                    ))}
                  </div>
                  {state.nextHandAt && <span className="muted small">Следующая раздача через {nextHandIn} с</span>}
                </div>
              )}
            </div>
          </div>

          {state.you?.seated && state.you.handName && (
            <div className="hand-readout" aria-live="polite">
              <span>Ваша комбинация</span>
              <b>{state.you.handName}</b>
              {state.board.length > 0 && (
                <em>
                  лучшие 5 из {state.you.holeCards.length + state.board.length}
                </em>
              )}
            </div>
          )}

          <div className="action-dock">
            {!state.you?.seated && <div className="waiting-action">Вы наблюдаете за столом</div>}

            {state.you?.seated && state.phase === 'playing' && !isMyTurn && (
              <div className="waiting-action">
                <span className="pulse-dot" />
                {state.actingSeat !== null
                  ? `Ход игрока ${state.players.find((player) => player.seat === state.actingSeat)?.nickname ?? ''}`
                  : 'Раздача продолжается'}
                {self?.stack === 0 && ' · ваш стек пуст'}
              </div>
            )}

            {state.you?.seated && legal && isMyTurn && (
              <div className="action-panel">
                {canAggress && (
                  <div className="raise-control">
                    <div className="raise-readout">
                      <span>{legal?.canBet ? 'Ставка' : 'Рейз до'}</span>
                      <b>{chips(raiseTo || aggressiveMin)}</b>
                    </div>
                    <input
                      className="slider"
                      type="range"
                      min={aggressiveMin}
                      max={aggressiveMax}
                      step={1}
                      value={raiseTo || aggressiveMin}
                      onChange={(event) => setRaiseTo(Number(event.target.value))}
                    />
                    <div className="raise-quick">
                      {[0.5, 1].map((fraction) => {
                        const target = Math.min(
                          aggressiveMax,
                          Math.max(aggressiveMin, state.currentBet + Math.round(state.pot * fraction))
                        );
                        return (
                          <button key={fraction} onClick={() => setRaiseTo(target)}>
                            {fraction === 0.5 ? '½ банка' : 'Банк'}
                          </button>
                        );
                      })}
                      <button onClick={() => setRaiseTo(aggressiveMax)}>Макс</button>
                    </div>
                  </div>
                )}

                <div className="action-buttons">
                  <button
                    className="action-button fold"
                    onClick={() => sendAction('fold')}
                    disabled={submitting || !legal?.canFold}
                  >
                    <span>Фолд</span>
                    <small>сбросить</small>
                  </button>

                  {legal?.canCheck && (
                    <button
                      className="action-button check"
                      onClick={() => sendAction('check')}
                      disabled={submitting}
                    >
                      <span>Чек</span>
                      <small>без ставки</small>
                    </button>
                  )}

                  {legal?.canCall && (
                    <button
                      className="action-button call"
                      onClick={() => sendAction('call')}
                      disabled={submitting}
                    >
                      <span>Колл {chips(legal.callAmount)}</span>
                      <small>уравнять</small>
                    </button>
                  )}

                  {canAggress && (
                    <button
                      className="action-button raise"
                      onClick={() => sendAction(legal!.canBet ? 'bet' : 'raise', raiseTo || aggressiveMin)}
                      disabled={submitting}
                    >
                      <span>
                        {legal?.canBet ? 'Бет' : 'Рейз'} {chips(raiseTo || aggressiveMin)}
                      </span>
                      <small>увеличить банк</small>
                    </button>
                  )}

                  <button
                    className="action-button allin"
                    onClick={() => sendAction('allin')}
                    disabled={submitting || !legal?.canAllIn}
                  >
                    <span>Олл-ин</span>
                    <small>{chips(legal?.allInAmount ?? 0)}</small>
                  </button>
                </div>
              </div>
            )}

            {state.you?.seated && self && self.stack === 0 && state.phase !== 'playing' && (
              <div className="rebuy-panel">
                <div>
                  <b>Стек закончился</b>
                  <span>Возьмите бесплатный стек или войдите снова с баланса.</span>
                </div>
                <button className="primary-button" onClick={rebuy}>
                  Пополнить стек
                </button>
              </div>
            )}

            {state.phase === 'waiting' && state.you?.seated && (
              <div className="waiting-action">
                <span className="pulse-dot" />
                Стол ждёт игроков. Раздача начнётся автоматически.
              </div>
            )}
          </div>
        </section>

        <aside className={`chat-panel ${chatOpen ? 'is-open' : ''}`}>
          <div className="chat-head">
            <div>
              <p className="eyebrow">За столом</p>
              <h3>Чат</h3>
            </div>
            <button className="icon-button chat-close" onClick={() => setChatOpen(false)} aria-label="Закрыть чат">
              ✕
            </button>
          </div>
          <div className="chat-messages">
            {chat.length === 0 && <p className="muted small">Сообщений пока нет. Скажите «привет» столу.</p>}
            {chat.map((message) => (
              <div
                key={message.id}
                className={`chat-message ${message.userId === user?.id ? 'is-mine' : ''}`}
              >
                <div className="chat-meta">
                  <b>{message.nickname}</b>
                  <span>
                    {new Date(message.at).toLocaleTimeString('ru-RU', {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
                <p>{message.text}</p>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <form className="chat-form" onSubmit={sendChat}>
            <input
              value={chatText}
              onChange={(event) => setChatText(event.target.value)}
              maxLength={200}
              placeholder="Сообщение…"
              aria-label="Сообщение в чат"
            />
            <button className="primary-button compact" disabled={!chatText.trim()}>
              →
            </button>
          </form>
        </aside>
      </div>

      <div className="table-footer-note">
        <span>Ход: {turnSeconds} секунд · автофолд по таймеру</span>
        <span>Фишки виртуальные · без покупки и вывода</span>
      </div>
    </div>
  );
}

function TableSeat({
  player,
  self,
  acting,
  position,
  remaining,
  turnSeconds,
  color
}: {
  player: TablePlayerState;
  self: boolean;
  acting: boolean;
  position: CSSProperties;
  remaining: number;
  turnSeconds: number;
  color: string;
}) {
  const hiddenCount = player.cards
    ? 0
    : player.status === 'active' || player.status === 'all-in' || player.status === 'disconnected'
      ? 2
      : 0;
  const label = statusLabel(player);

  return (
    <div
      className={`table-seat ${self ? 'is-self' : ''} ${acting ? 'is-acting' : ''} ${
        player.folded ? 'is-folded' : ''
      } ${player.stack === 0 ? 'is-broke' : ''}`}
      style={{ ...position, '--seat-color': self ? '#4ddead' : color } as CSSProperties}
    >
      <div className="seat-cards">
        {player.cards ? (
          <CardRow cards={player.cards} small={!self} />
        ) : hiddenCount > 0 ? (
          <CardRow cards={[]} hiddenCount={hiddenCount} small={!self} />
        ) : null}
      </div>

      <div className="seat-body">
        <div className="seat-avatar-wrap">
          <Avatar
            avatarUrl={player.avatarUrl}
            preset={player.avatarPreset}
            size={self ? 58 : 48}
            ring={acting ? '#f2cd7a' : player.connected ? 'rgba(255,255,255,.15)' : '#a55757'}
          />
          {acting && (
            <span
              className="seat-timer"
              style={{
                background: `conic-gradient(#f2cd7a ${(remaining / turnSeconds) * 360}deg, rgba(255,255,255,.12) 0)`
              }}
            />
          )}
          <div className="seat-badges">
            {player.isButton && <span className="dealer-badge">D</span>}
            {player.isSmallBlind && <span className="blind-badge">SB</span>}
            {player.isBigBlind && <span className="blind-badge">BB</span>}
          </div>
        </div>
        <div className="seat-info">
          <span className="seat-name" title={player.nickname}>
            {player.nickname}
            {self && <em> вы</em>}
          </span>
          <span className="seat-stack">{compactChips(player.stack)}</span>
          {label && <span className={`seat-status status-${player.status}`}>{label}</span>}
          {player.lastAction && (
            <span className="last-action">
              {ACTION_LABEL[player.lastAction.type] ?? player.lastAction.type}
              {player.lastAction.amount > 0 &&
                player.lastAction.type !== 'call' &&
                player.lastAction.type !== 'bet' &&
                player.lastAction.type !== 'raise'
                ? ''
                : ''}
            </span>
          )}
        </div>
      </div>

      {player.bet > 0 && (
        <div className="seat-bet">
          <ChipMark size={16} />
          {chips(player.bet)}
        </div>
      )}
    </div>
  );
}
