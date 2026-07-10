import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { initFetchAuth } from '../api/fetchWithAuth';

export interface User {
  id: string;
  telegramId: string;
  firstName: string;
  lastName?: string | null;
  username?: string | null;
  role: 'USER' | 'AUTHOR' | 'ADMIN';
  authorId?: string | null;
  permissions?: string[];
}

interface AuthContextValue {
  getToken: () => string | null;
  setToken: (token: string) => void;
  clearToken: () => void;
  user: User | null;
  setUser: (user: User | null) => void;
  isAuthenticated: boolean | null;
  setIsAuthenticated: (v: boolean | null) => void;
  triggerForceLogout: (reason: 'expired' | 'other_tab') => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const tokenRef = useRef<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  const getToken = useCallback(() => tokenRef.current, []);

  const setToken = useCallback((token: string) => {
    tokenRef.current = token;
  }, []);

  const clearToken = useCallback(() => {
    tokenRef.current = null;
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  const triggerForceLogout = useCallback(
    (reason: 'expired' | 'other_tab') => {
      clearToken();
      toast(
        reason === 'other_tab'
          ? 'Вы вышли в другой вкладке.'
          : 'Сессия истекла. Войдите снова.',
        { duration: 2000 }
      );
      // Navigate after clearing — RequireAuth also handles redirect,
      // but explicit navigate covers edge cases (e.g. BroadcastChannel on /login).
      navigate('/login');
    },
    [clearToken, navigate]
  );

  // Wire up fetchWithAuth with stable auth callbacks.
  // Called on every render, but all three functions are stable (useCallback + []).
  initFetchAuth({ getToken, setToken, triggerForceLogout });

  // Multi-tab sync via BroadcastChannel.
  useEffect(() => {
    const channel = new BroadcastChannel('auth_channel');
    channel.onmessage = (e) => {
      if (e.data?.type === 'TOKEN_REFRESHED' && e.data.token) {
        setToken(e.data.token);
      }
      if (e.data?.type === 'LOGOUT') {
        triggerForceLogout('other_tab');
      }
    };
    return () => channel.close();
  }, [setToken, triggerForceLogout]);

  return (
    <AuthContext.Provider
      value={{
        getToken,
        setToken,
        clearToken,
        user,
        setUser,
        isAuthenticated,
        setIsAuthenticated,
        triggerForceLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
