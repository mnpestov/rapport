import { API_URL } from './config';

// Auth functions injected from AuthProvider to avoid circular imports.
let _getToken: () => string | null = () => null;
let _setToken: (t: string) => void = () => {};
let _triggerForceLogout: (r: 'expired' | 'other_tab') => void = () => {};

export function initFetchAuth(deps: {
  getToken: () => string | null;
  setToken: (t: string) => void;
  triggerForceLogout: (r: 'expired' | 'other_tab') => void;
}) {
  _getToken = deps.getToken;
  _setToken = deps.setToken;
  _triggerForceLogout = deps.triggerForceLogout;
}

// Single-flight mutex — at most one refresh request in flight at a time.
// Parallel 401s queue up and all get the same new token.
let refreshPromise: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!res.ok) return null;
      const { token } = await res.json();
      _setToken(token);
      try {
        const bc = new BroadcastChannel('auth_channel');
        bc.postMessage({ type: 'TOKEN_REFRESHED', token });
        bc.close();
      } catch {
        // BroadcastChannel not available in some envs
      }
      return token;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function fetchWithAuth(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = _getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(url, { ...init, headers });

  if (res.status === 401) {
    const newToken = await doRefresh();
    if (!newToken) {
      _triggerForceLogout('expired');
      return res;
    }
    const retryHeaders = new Headers(init.headers);
    retryHeaders.set('Authorization', `Bearer ${newToken}`);
    return fetch(url, { ...init, headers: retryHeaders });
  }

  return res;
}
