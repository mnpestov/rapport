import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchPriceAlerts,
  subscribePriceAlert,
  unsubscribePriceAlert,
} from '../api/priceAlertsApi';
import { hasSession } from '../api/authSession';

// Подписка на снижение цены описания (implementation_plan.md — «Подписка на цены»).
// По образцу FavoritesContext, но:
//  - нет миграции из localStorage (легаси-данных нет);
//  - init() грузит данные только если у пользователя есть PRICE_ALERT
//    (иначе лишний фоновый запрос у всех при старте);
//  - toggleAlert — async, при ошибке откатывает состояние И бросает наружу
//    (компонент PatternDetails ловит и показывает сообщение локально).

interface PriceAlertsContextType {
  alerts: string[];
  isSubscribed: (patternId: string) => boolean;
  toggleAlert: (patternId: string) => Promise<void>;
  isLoading: boolean;
}

const PriceAlertsContext = createContext<PriceAlertsContextType | undefined>(undefined);

export const PriceAlertsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [alerts, setAlerts] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      // Грузим данные только если у пользователя есть доступ. Читаем
      // localStorage напрямую (те же 3 строки, что внутри readAccess в
      // usePremiumAccess.ts) — не импортируем приватную функцию модуля.
      let hasPriceAlert = false;
      try {
        const raw = localStorage.getItem('user_data');
        const data = raw ? JSON.parse(raw) : null;
        const isAdmin = data?.role === 'ADMIN';
        hasPriceAlert = isAdmin || (data?.permissions ?? []).includes('PRICE_ALERT');
      } catch {
        hasPriceAlert = false;
      }

      if (!hasPriceAlert) {
        if (isMounted) {
          setAlerts([]);
          setIsLoading(false);
        }
        return;
      }

      try {
        const ids = await fetchPriceAlerts();
        if (isMounted) setAlerts(ids);
      } catch (e) {
        console.error('[PriceAlerts] Failed to load:', e);
        if (isMounted) setAlerts([]);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    // Запуск — тем же приёмом, что в FavoritesContext.
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

  const alertsRef = useRef<string[]>(alerts);
  useEffect(() => { alertsRef.current = alerts; }, [alerts]);

  // Оптимистичное обновление; при ошибке — откат и re-throw (компонент
  // покажет сообщение сам).
  const toggleAlert = useCallback(async (id: string): Promise<void> => {
    const wasSubscribed = alertsRef.current.includes(id);

    setAlerts(prev => wasSubscribed ? prev.filter(x => x !== id) : [...prev, id]);

    try {
      await (wasSubscribed ? unsubscribePriceAlert(id) : subscribePriceAlert(id));
    } catch (err) {
      setAlerts(prev => wasSubscribed ? [...prev, id] : prev.filter(x => x !== id));
      throw err;
    }
  }, []);

  const isSubscribed = useCallback(
    (id: string) => alerts.includes(id),
    [alerts],
  );

  return (
    <PriceAlertsContext.Provider value={{ alerts, isSubscribed, toggleAlert, isLoading }}>
      {children}
    </PriceAlertsContext.Provider>
  );
};

export const usePriceAlerts = () => {
  const context = useContext(PriceAlertsContext);
  if (context === undefined) {
    throw new Error('usePriceAlerts must be used within a PriceAlertsProvider');
  }
  return context;
};
