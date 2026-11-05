import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function ProtectedRoute() {
  const { token, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="full-loader">
        <div className="loader-ring" />
        <p>Открываем стол…</p>
      </div>
    );
  }

  if (!token) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <Outlet />;
}
