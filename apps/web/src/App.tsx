import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthPage } from './pages/AuthPage';
import { NotFoundPage } from './pages/NotFoundPage';

// Route-level code splitting keeps the first download small on mobile networks:
// the login screen does not pull in the table, profile or leaderboard code.
const ForgotPasswordPage = lazy(() =>
  import('./pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage }))
);
const ResetPasswordPage = lazy(() =>
  import('./pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage }))
);
const LobbyPage = lazy(() => import('./pages/LobbyPage').then((m) => ({ default: m.LobbyPage })));
const TablePage = lazy(() => import('./pages/TablePage').then((m) => ({ default: m.TablePage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const LeaderboardPage = lazy(() =>
  import('./pages/LeaderboardPage').then((m) => ({ default: m.LeaderboardPage }))
);

function RouteFallback() {
  return (
    <div className="page-loading">
      <div className="loader-ring" />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to="/lobby" replace />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route
              path="/lobby"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <LobbyPage />
                </Suspense>
              }
            />
            <Route
              path="/table/:id"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <TablePage />
                </Suspense>
              }
            />
            <Route
              path="/profile"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <ProfilePage />
                </Suspense>
              }
            />
            <Route
              path="/leaderboard"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <LeaderboardPage />
                </Suspense>
              }
            />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
