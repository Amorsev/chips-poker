import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { chips } from '../lib/format';
import { Avatar } from './Avatar';
import { ChipMark, Logo } from './Logo';

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!user) return null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <button className="logo-button" onClick={() => navigate('/lobby')} aria-label="На главную">
            <Logo />
          </button>

          <nav className={`main-nav ${menuOpen ? 'is-open' : ''}`}>
            <NavLink to="/lobby" onClick={() => setMenuOpen(false)}>
              Лобби
            </NavLink>
            <NavLink to="/leaderboard" onClick={() => setMenuOpen(false)}>
              Лидеры
            </NavLink>
            <NavLink to="/profile" onClick={() => setMenuOpen(false)}>
              Профиль
            </NavLink>
          </nav>

          <div className="topbar-actions">
            <div className="balance-pill" title="Игровой баланс">
              <ChipMark size={20} />
              <span>{chips(user.chips)}</span>
            </div>
            <button className="user-chip" onClick={() => navigate('/profile')} title="Профиль">
              <Avatar
                avatarUrl={user.avatarUrl}
                preset={user.avatarPreset}
                size={34}
                ring="rgba(77, 219, 173, .45)"
              />
              <span className="user-chip-name">{user.nickname}</span>
            </button>
            <button
              className="icon-button menu-toggle"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="Меню"
            >
              {menuOpen ? '✕' : '☰'}
            </button>
            <button
              className="ghost-button logout-button"
              onClick={() => {
                logout();
                navigate('/login');
              }}
            >
              Выйти
            </button>
          </div>
        </div>
      </header>

      <main className="page">
        <Outlet />
      </main>

      <footer className="footer">
        <span>Chips Poker · социальная игра</span>
        <span>Фишки бесплатны, не имеют денежной стоимости и не подлежат выводу</span>
      </footer>
    </div>
  );
}
