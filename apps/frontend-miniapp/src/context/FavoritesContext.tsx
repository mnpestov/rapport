import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  fetchFavorites,
  addFavorite as apiAddFavorite,
  removeFavorite as apiRemoveFavorite,
  importFavorites,
} from '../api/favoritesApi';
import { hasSession } from '../api/authSession';

const LS_KEY = 'favorites';
const LS_SYNCED_KEY = 'favorites_synced';

interface FavoritesContextType {
  favorites: string[];
  isLoading: boolean;
  toggleFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;
}

const FavoritesContext = createContext<FavoritesContextType | undefined>(undefined);

export const FavoritesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      try {
        // 1. Load from DB
        const dbFavorites = await fetchFavorites();

        // 2. Check localStorage for un-synced data (first run migration)
        const alreadySynced = localStorage.getItem(LS_SYNCED_KEY) === 'true';
        let localFavorites: string[] = [];
        if (!alreadySynced) {
          try {
            const stored = localStorage.getItem(LS_KEY);
            localFavorites = stored ? JSON.parse(stored) : [];
          } catch {
            localFavorites = [];
          }
        }

        // 3. If there's local data that hasn't been synced, import it to DB
        if (localFavorites.length > 0) {
          try {
            await importFavorites(localFavorites);
            localStorage.setItem(LS_SYNCED_KEY, 'true');
            localStorage.removeItem(LS_KEY);
          } catch (e) {
            console.error('[Favorites] Import from localStorage failed, will retry next time:', e);
            // Don't mark as synced so we retry on next open
          }
        } else if (!alreadySynced) {
          // No local data to migrate — mark as done to skip this check on next launch
          localStorage.setItem(LS_SYNCED_KEY, 'true');
        }

        // 4. Merge DB + local (deduped) as initial state
        const merged = Array.from(new Set([...dbFavorites, ...localFavorites]));
        if (isMounted) setFavorites(merged);
      } catch (e) {
        console.error('[Favorites] Failed to load from DB, falling back to localStorage:', e);
        // Fallback: use localStorage if API is unreachable
        try {
          const stored = localStorage.getItem(LS_KEY);
          if (isMounted) setFavorites(stored ? JSON.parse(stored) : []);
        } catch {
          if (isMounted) setFavorites([]);
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    // FIX 1: Run init() only after JWT is available.
    // If a token already exists (returning user / page reload), start immediately.
    // Otherwise, wait for the 'auth:ready' event dispatched by authApi.authenticate().
    //
    // hasSession(), а не прямое чтение localStorage: в браузерном режиме
    // access-токен живёт в памяти, и проверка хранилища всегда давала бы
    // false — избранное молча перестало бы синхронизироваться с сервером
    // (BROWSER_ACCESS_PLAN.md §3.4).
    if (hasSession()) {
      init();
    } else {
      const onAuthReady = () => { if (isMounted) init(); };
      window.addEventListener('auth:ready', onAuthReady, { once: true });
      return () => {
        isMounted = false;
        window.removeEventListener('auth:ready', onAuthReady);
      };
    }

    return () => { isMounted = false; };
  }, []);

  const favoritesRef = React.useRef<string[]>(favorites);
  // Keep ref in sync so toggleFavorite always sees the latest state
  // without capturing it in the useCallback closure.
  React.useEffect(() => { favoritesRef.current = favorites; }, [favorites]);

  const toggleFavorite = useCallback((id: string) => {
    // Read the latest state via ref — no stale closure, no side effects inside updater.
    const isCurrentlyFavorite = favoritesRef.current.includes(id);

    // 1. Pure updater: only computes next state, no side effects.
    setFavorites(prev =>
      prev.includes(id) ? prev.filter(fId => fId !== id) : [...prev, id]
    );

    // 2. Mirror to localStorage (side effect, outside updater).
    const newFavorites = isCurrentlyFavorite
      ? favoritesRef.current.filter(fId => fId !== id)
      : [...favoritesRef.current, id];
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(newFavorites));
    } catch { /* ignore storage quota errors */ }

    // 3. Persist to DB (side effect, outside updater, fire-and-forget).
    const apiCall = isCurrentlyFavorite
      ? apiRemoveFavorite(id)
      : apiAddFavorite(id);

    apiCall.catch((e) => {
      // Do NOT revert — change preserved locally.
      // Clear LS_SYNCED_KEY so next launch re-imports from localStorage.
      console.error('[Favorites] Failed to sync with DB, change preserved locally:', e);
      localStorage.removeItem(LS_SYNCED_KEY);
    });
  }, []);

  const isFavorite = useCallback((id: string) => favorites.includes(id), [favorites]);

  return (
    <FavoritesContext.Provider value={{ favorites, isLoading, toggleFavorite, isFavorite }}>
      {children}
    </FavoritesContext.Provider>
  );
};

export const useFavorites = () => {
  const context = useContext(FavoritesContext);
  if (context === undefined) {
    throw new Error('useFavorites must be used within a FavoritesProvider');
  }
  return context;
};
