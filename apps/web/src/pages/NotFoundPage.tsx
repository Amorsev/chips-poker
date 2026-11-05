import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="simple-auth-page">
      <div className="empty-state">
        <p className="eyebrow">404</p>
        <h1>Страница ушла в фолд</h1>
        <p className="muted">Такого адреса нет. Вернитесь в лобби и выберите стол.</p>
        <Link className="primary-button" to="/lobby">
          В лобби
        </Link>
      </div>
    </div>
  );
}
