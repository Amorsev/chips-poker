import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, ApiError } from '../lib/api';
import { chips, LEAGUE_COLOR, LEAGUE_LABEL, relativeTime, TX_LABEL } from '../lib/format';
import type { ProfilePayload, User } from '../types';
import { Avatar } from '../components/Avatar';
import { CardRow } from '../components/PlayingCard';
import { Modal } from '../components/Modal';
import { ChipMark } from '../components/Logo';

export function ProfilePage() {
  const { token, user, avatarPresets, setUser, refreshProfile } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [nicknameOpen, setNicknameOpen] = useState(false);
  const [nickname, setNickname] = useState(user?.nickname ?? '');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const payload = await api<ProfilePayload>('/profile/me', {}, token);
      setData(payload);
      setUser(payload.user);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Не удалось загрузить профиль', 'error');
    } finally {
      setLoading(false);
    }
  }, [token, setUser, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="page-loading">
        <div className="loader-ring" />
        <p>Загружаем статистику…</p>
      </div>
    );
  }

  if (!user) return null;

  async function updatePreset(preset: string) {
    if (!token) return;
    setBusy(true);
    try {
      const response = await api<{ user: User }>(
        '/profile/me',
        { method: 'PATCH', body: JSON.stringify({ avatarPreset: preset }) },
        token
      );
      setUser(response.user);
      toast.show('Аватар обновлён', 'success');
      setAvatarOpen(false);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Не удалось обновить аватар', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !token) return;
    const form = new FormData();
    form.append('avatar', file);
    setBusy(true);
    try {
      const response = await api<{ user: User }>(
        '/profile/avatar',
        { method: 'POST', body: form },
        token
      );
      setUser(response.user);
      toast.show('Фото загружено', 'success');
      setAvatarOpen(false);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Не удалось загрузить фото', 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function saveNickname() {
    if (!token) return;
    setBusy(true);
    try {
      const response = await api<{ user: User }>(
        '/profile/me',
        { method: 'PATCH', body: JSON.stringify({ nickname }) },
        token
      );
      setUser(response.user);
      setNicknameOpen(false);
      toast.show('Никнейм обновлён', 'success');
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Не удалось изменить никнейм', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-page">
      <section className="profile-hero" style={{ '--league': LEAGUE_COLOR[user.league] } as React.CSSProperties}>
        <div className="profile-identity">
          <button className="avatar-edit" onClick={() => setAvatarOpen(true)} title="Сменить аватар">
            <Avatar avatarUrl={user.avatarUrl} preset={user.avatarPreset} size={104} ring={LEAGUE_COLOR[user.league]} />
            <span>✎</span>
          </button>
          <div>
            <p className="eyebrow">{LEAGUE_LABEL[user.league]} · {user.email}</p>
            <h1>
              {user.nickname}
              <button className="icon-button pencil" onClick={() => { setNickname(user.nickname); setNicknameOpen(true); }}>
                ✎
              </button>
            </h1>
            <p className="muted">
              В игре с {new Date(user.createdAt).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>
        <div className="profile-balance">
          <span>Текущий баланс</span>
          <strong>
            <ChipMark size={30} />
            {chips(user.chips)}
          </strong>
          <button className="secondary-button compact" onClick={() => void refreshProfile()}>
            Обновить
          </button>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard label="Сыграно раздач" value={chips(user.handsPlayed)} hint={`${chips(user.handsWon)} побед`} />
        <StatCard label="Всего выиграно" value={`+${chips(user.totalWon)}`} tone="positive" hint="сумма всех банков" />
        <StatCard label="Всего проиграно" value={`−${chips(user.totalLost)}`} tone="negative" hint="сумма чистых потерь" />
        <StatCard label="Win Rate" value={`${user.winRate.toFixed(1)}%`} hint="раздачи с выигрышем" />
      </section>

      <div className="profile-columns">
        <section className="panel hands-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">История</p>
              <h2>Последние раздачи</h2>
            </div>
            <button className="text-button" onClick={() => void load()}>
              Обновить
            </button>
          </div>

          {!data?.recentHands.length ? (
            <div className="empty-state compact">
              Раздач пока нет. <Link to="/lobby">Сядьте за стол</Link> и сыграйте первую руку.
            </div>
          ) : (
            <div className="hands-table-wrap">
              <table className="hands-table">
                <thead>
                  <tr>
                    <th>Стол</th>
                    <th>Карманные</th>
                    <th>Борд</th>
                    <th>Результат</th>
                    <th>Банк</th>
                    <th>Итог</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentHands.map((hand) => (
                    <tr key={hand.id}>
                      <td>
                        <b>{hand.tableName}</b>
                        <span className="cell-sub">{relativeTime(hand.playedAt)}</span>
                      </td>
                      <td>
                        <CardRow cards={hand.holeCards} small muted={hand.folded} />
                      </td>
                      <td>
                        {hand.board.length ? <CardRow cards={hand.board} small /> : <span className="muted">—</span>}
                      </td>
                      <td>
                        <span className={`result-pill result-${hand.result.toLowerCase()}`}>
                          {hand.result === 'WON' ? 'Победа' : hand.result === 'FOLDED' ? 'Фолд' : 'Проигрыш'}
                        </span>
                        {hand.bestHand && <span className="cell-sub">{hand.bestHand}</span>}
                      </td>
                      <td>{chips(hand.pot)}</td>
                      <td className={hand.netAmount >= 0 ? 'positive' : 'negative'}>
                        <b>{hand.netAmount >= 0 ? '+' : '−'}{chips(Math.abs(hand.netAmount))}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="panel ledger-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Операции</p>
              <h2>Движение фишек</h2>
            </div>
          </div>
          <div className="ledger-list">
            {data?.transactions.map((tx) => (
              <div key={tx.id} className="ledger-row">
                <span className={`ledger-icon ${tx.amount >= 0 ? 'in' : 'out'}`}>{tx.amount >= 0 ? '+' : '−'}</span>
                <div>
                  <b>{TX_LABEL[tx.type] ?? tx.type}</b>
                  <span>{relativeTime(tx.createdAt)}</span>
                </div>
                <strong className={tx.amount >= 0 ? 'positive' : 'negative'}>
                  {tx.amount >= 0 ? '+' : '−'}{chips(Math.abs(tx.amount))}
                </strong>
              </div>
            ))}
            {!data?.transactions.length && <p className="muted small">Операций пока нет.</p>}
          </div>
        </aside>
      </div>

      <section className="fair-play-note">
        <Avatar avatarUrl={null} preset="🛡️" size={44} />
        <div>
          <b>Честная игра</b>
          <p>
            Все фишки в Chips Poker — бесплатные виртуальные очки. Их нельзя купить, продать,
            передать или вывести. Мы фиксируем устройства и IP при регистрации, чтобы
            ограничивать мультиаккаунты.
          </p>
        </div>
      </section>

      <Modal open={avatarOpen} title="Аватар" onClose={() => setAvatarOpen(false)}>
        <div className="avatar-modal">
          <div className="avatar-preview">
            <Avatar avatarUrl={user.avatarUrl} preset={user.avatarPreset} size={92} />
          </div>
          <label className="upload-button">
            Загрузить фото
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => void uploadAvatar(event)}
              hidden
            />
          </label>
          <p className="muted small">JPG, PNG или WebP до 2 МБ.</p>
          <div className="avatar-presets">
            {avatarPresets.map((preset) => (
              <button
                key={preset}
                className={!user.avatarUrl && user.avatarPreset === preset ? 'is-active' : ''}
                onClick={() => void updatePreset(preset)}
                disabled={busy}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
      </Modal>

      <Modal
        open={nicknameOpen}
        title="Изменить никнейм"
        onClose={() => setNicknameOpen(false)}
        footer={
          <>
            <button className="ghost-button" onClick={() => setNicknameOpen(false)}>
              Отмена
            </button>
            <button className="primary-button" onClick={() => void saveNickname()} disabled={busy}>
              Сохранить
            </button>
          </>
        }
      >
        <label className="buyin-label">
          <span>Новый никнейм</span>
          <input
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            minLength={3}
            maxLength={20}
            pattern="[A-Za-zА-Яа-яЁё0-9_]+"
          />
        </label>
        <p className="muted small">3–20 символов. Никнейм виден за столом и в рейтинге.</p>
      </Modal>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'positive' | 'negative';
}) {
  return (
    <div className={`stat-card ${tone ?? ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}
