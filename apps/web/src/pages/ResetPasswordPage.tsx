import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { ChipMark } from '../components/Logo';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (password !== repeat) {
      setError('Пароли не совпадают');
      return;
    }
    setBusy(true);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password })
      });
      navigate('/login', { replace: true, state: { reset: true } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сменить пароль');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="simple-auth-page">
      <div className="simple-auth-card">
        <Link to="/login" className="simple-brand">
          <ChipMark size={36} /> CHIPS POKER
        </Link>
        <p className="eyebrow">Безопасность</p>
        <h1>Новый пароль</h1>
        {!token ? (
          <p className="form-error">В ссылке отсутствует токен. Запросите восстановление снова.</p>
        ) : (
          <form onSubmit={submit} className="stack-form">
            <label>
              <span>Новый пароль</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <label>
              <span>Повторите пароль</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
                required
              />
            </label>
            {error && <div className="form-error">{error}</div>}
            <button className="primary-button wide" disabled={busy}>
              {busy ? 'Сохраняем…' : 'Сменить пароль'}
            </button>
          </form>
        )}
        <p className="auth-links">
          <Link to="/forgot-password">Запросить новую ссылку</Link>
        </p>
      </div>
    </div>
  );
}
