import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { api } from '../lib/api';
import type { ProfilePayload, User } from '../types';

const TOKEN_KEY = 'chips_poker_token';

interface AuthResponse {
  token: string;
  user: User;
}

interface AuthContextValue {
  token: string | null;
  user: User | null;
  avatarPresets: string[];
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, nickname: string) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<User | null>(null);
  const [avatarPresets, setAvatarPresets] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (activeToken: string) => {
    const payload = await api<ProfilePayload>('/profile/me', {}, activeToken);
    setUser(payload.user);
    setAvatarPresets(payload.avatarPresets);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setLoading(false);
      return;
    }
    loadProfile(token)
      .catch(() => {
        if (cancelled) return;
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, loadProfile]);

  const applyAuth = useCallback((response: AuthResponse) => {
    localStorage.setItem(TOKEN_KEY, response.token);
    setToken(response.token);
    setUser(response.user);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await api<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      applyAuth(response);
      await loadProfile(response.token);
    },
    [applyAuth, loadProfile]
  );

  const register = useCallback(
    async (email: string, password: string, nickname: string) => {
      const response = await api<AuthResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, nickname })
      });
      applyAuth(response);
      await loadProfile(response.token);
    },
    [applyAuth, loadProfile]
  );

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    // Loaded on demand: socket.io-client is only needed once a table is opened,
    // and if it was never loaded there is no socket to close.
    void import('../lib/socket').then(({ disconnectSocket }) => disconnectSocket());
    setToken(null);
    setUser(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!token) return;
    await loadProfile(token);
  }, [loadProfile, token]);

  const value = useMemo(
    () => ({
      token,
      user,
      avatarPresets,
      loading,
      login,
      register,
      logout,
      refreshProfile,
      setUser
    }),
    [token, user, avatarPresets, loading, login, register, logout, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
