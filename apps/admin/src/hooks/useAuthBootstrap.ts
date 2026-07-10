import { useEffect, useState } from 'react';
import { API_URL } from '../api/config';
import { useAuth } from '../contexts/AuthContext';

export function useAuthBootstrap() {
  const { setToken, setUser, setIsAuthenticated } = useAuth();
  const [showSpinner, setShowSpinner] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) setShowSpinner(true);
    }, 150);

    (async () => {
      try {
        const refreshRes = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });

        if (!refreshRes.ok) throw new Error('refresh failed');

        const { token } = await refreshRes.json();

        const meRes = await fetch(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!meRes.ok) throw new Error('me failed');

        const { user } = await meRes.json();

        if (cancelled) return;
        clearTimeout(timer);
        setToken(token);
        setUser(user);
        setIsAuthenticated(user.role === 'ADMIN');
      } catch {
        if (cancelled) return;
        clearTimeout(timer);
        setIsAuthenticated(false);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { showSpinner };
}
