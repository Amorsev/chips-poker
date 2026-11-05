import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../lib/api';
import { ChipMark } from '../components/Logo';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { token, loading, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!loading && token) return <Navigate to="/lobby" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, nickname);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/lobby', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось выполнить запрос');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-poster">
        <div className="auth-brand">
          <ChipMark size={48} />
          <span>
            CHIPS<em>POKER</em>
          </span>
        </div>
        <div className="poster-felt">
          <div className="poster-card poster-card-a">A♠</div>
          <div className="poster-card poster-card-b">K♥</div>
          <div className="poster-chips">
            <span />
            <span />
            <span />
          </div>
          <div className="poster-copy">
            <p className="eyebrow">Социальный покер</p>
            <h1>
              Хорошие руки.
              <br />
              Ноль риска.
            </h1>
            <p>
              Техасский Холдем на виртуальные фишки. Бесплатный стек, живые столы,
              лиги и честная борьба за первое место.
            </p>
          </div>
        </div>
        <ul className="poster-points">
          <li>
            <b>10 000</b> фишек при регистрации
          </li>
          <li>
            <b>4 лиги</b> от новичка до хайроллера
          </li>
          <li>
            <b>0 ₽</b> — фишки нельзя купить или вывести
          </li>
        </ul>
      </section>

      <section className="auth-panel">
        <div className="auth-form-wrap">
          <p className="eyebrow">{mode === 'login' ? 'С возвращением' : 'Новый игрок'}</p>
          <h2>{mode === 'login' ? 'Войти в игру' : 'Создать аккаунт'}</h2>
          <p className="muted auth-sub">
            {mode === 'login'
              ? 'Продолжите игру с того места, где остановились.'
              : 'Получите 10 000 фишек и место за первым столом.'}
          </p>

          <form onSubmit={submit} className="stack-form">
            <label>
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="player@example.com"
                required
              />
            </label>

            {mode === 'register' && (
              <label>
                <span>Никнейм</span>
                <input
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder="allin_panda"
                  minLength={3}
                  maxLength={20}
                  pattern="[A-Za-zА-Яа-яЁё0-9_]+"
                  autoComplete="nickname"
                  required
                />
                <small>3–20 символов: буквы, цифры и подчёркивание. Виден другим игрокам.</small>
              </label>
            )}

            <label>
              <span>Пароль</span>
              <input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Минимум 8 символов"
                minLength={8}
                maxLength={128}
                required
              />
            </label>

            {error && <div className="form-error">{error}</div>}

            <button className="primary-button wide" type="submit" disabled={busy}>
              {busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Играть бесплатно'}
            </button>
          </form>

          <div className="auth-links">
            {mode === 'login' ? (
              <>
                <Link to="/forgot-password">Забыли пароль?</Link>
                <span>
                  Нет аккаунта? <Link to="/register">Регистрация</Link>
                </span>
              </>
            ) : (
              <span>
                Уже есть аккаунт? <Link to="/login">Войти</Link>
              </span>
            )}
          </div>

          <p className="legal-note">
            Регистрируясь, вы подтверждаете, что вам исполнилось 18 лет. Игра не является
            азартной: фишки нематериальны, бесплатны и не подлежат обмену на деньги.
          </p>
        </div>
      </section>
    </div>
  );
}
