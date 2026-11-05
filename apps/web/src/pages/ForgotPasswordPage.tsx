import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { ChipMark } from '../components/Logo';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email })
      });
    } finally {
      setBusy(false);
      setSent(true);
    }
  }

  return (
    <div className="simple-auth-page">
      <div className="simple-auth-card">
        <Link to="/login" className="simple-brand">
          <ChipMark size={36} /> CHIPS POKER
        </Link>
        <p className="eyebrow">Восстановление доступа</p>
        <h1>Забыли пароль?</h1>
        {sent ? (
          <>
            <p className="muted">
              Если аккаунт с адресом <b>{email}</b> существует, мы отправили ссылку для сброса.
              Проверьте почту и папку «Спам».
            </p>
            <Link className="primary-button wide" to="/login">
              Вернуться ко входу
            </Link>
          </>
        ) : (
          <form onSubmit={submit} className="stack-form">
            <p className="muted">Укажите email аккаунта — отправим ссылку на смену пароля.</p>
            <label>
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                placeholder="player@example.com"
              />
            </label>
            <button className="primary-button wide" disabled={busy}>
              {busy ? 'Отправляем…' : 'Отправить ссылку'}
            </button>
          </form>
        )}
        <p className="auth-links">
          <Link to="/login">← Назад ко входу</Link>
        </p>
      </div>
    </div>
  );
}
