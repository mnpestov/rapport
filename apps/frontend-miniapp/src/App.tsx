import React, { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Catalog } from './pages/Catalog/Catalog';
import { PatternDetails } from './pages/PatternDetails/PatternDetails';
import { Favorites } from './pages/Favorites/Favorites';
import { LoadingScreen } from './pages/LoadingScreen/LoadingScreen';
import { SubscriptionRequired } from './pages/SubscriptionRequired/SubscriptionRequired';
import { Maintenance } from './pages/Maintenance/Maintenance';
import { authenticate } from './api/authApi';
import { TelegramOnly } from './pages/TelegramOnly/TelegramOnly';
import { UpdateTelegram } from './pages/UpdateTelegram/UpdateTelegram';

function logFrontend(event: string, extra?: Record<string, unknown>) {
  const payload = { event, userAgent: navigator.userAgent, ...extra };
  fetch('/diag/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

import { fetchChannelInfo, ChannelInfo } from './api/channelApi';

const MAINTENANCE_MODE = false;

type AppState = "loading" | "fetching_channel" | "unauthorized" | "authorized" | "telegram_only" | "update_telegram";

function App() {
  const [appState, setAppState] = useState<AppState>("loading");
  const [channelInfo, setChannelInfo] = useState<ChannelInfo | null>(null);

  useEffect(() => {
    let isMounted = true;

    // Clear saved catalog filters on fresh app start
    sessionStorage.removeItem('catalog_search');
    sessionStorage.removeItem('catalog_free_filter');
    sessionStorage.removeItem('catalog_new_filter');
    sessionStorage.removeItem('catalog_advanced_filters');

    // Инициализация Telegram Web App (Этап 1)
    try {
      const tg = (window as any).Telegram?.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();
        if (import.meta.env.DEV) {
          // Development mode initData hook
        }
      }
    } catch (e) {
      console.error("Failed to initialize Telegram WebApp", e);
    }

    const checkAccess = async () => {
      if (isMounted) setAppState("loading");
      try {
        const tg = (window as any).Telegram?.WebApp;
        let initData = tg?.initData || "";

        const telegramId = tg?.initDataUnsafe?.user?.id ?? null;
        logFrontend('AUTH_START', {
          telegramId,
          initDataLength: initData.length,
          tgExists: !!tg,
          tgVersion: tg?.version ?? null,
          platform: tg?.platform ?? null,
        });

        if (!import.meta.env.DEV) {
          if (!tg) {
            // telegram-web-app.js не загрузился (telegram.org заблокирован или старый клиент)
            if (/Telegram/i.test(navigator.userAgent)) {
              logFrontend('AUTH_OUTDATED_TELEGRAM', {});
              if (isMounted) setAppState("update_telegram");
            } else {
              logFrontend('AUTH_BROWSER_ACCESS', {});
              if (isMounted) setAppState("telegram_only");
            }
            return;
          }
          if (tg.platform === 'unknown' && !initData) {
            // telegram-web-app.js загрузился, но открыто в браузере (не в Telegram)
            logFrontend('AUTH_BROWSER_ACCESS', {});
            if (isMounted) setAppState("telegram_only");
            return;
          }
        }

        if (!initData && import.meta.env.DEV) {
          initData = "mock_dev";
        }

        if (!initData) {
          logFrontend('AUTH_EMPTY_INITDATA', { telegramId });
          await new Promise(resolve => setTimeout(resolve, 1500));
          const tgRetry = (window as any).Telegram?.WebApp;
          initData = tgRetry?.initData || "";
          if (!initData) {
            logFrontend('AUTH_GUARD_FIRED', { telegramId });
            if (isMounted) setAppState("unauthorized");
            return;
          }
          logFrontend('AUTH_EMPTY_RETRY_OK', { telegramId, initDataLength: initData.length });
        }

        const response = await authenticate(initData);
        logFrontend('AUTH_RESULT', { telegramId, isSubscriber: response.isSubscriber });
        if (isMounted) {
          if (response.isSubscriber) {
            logFrontend('APP_READY', { telegramId });
            setAppState("authorized");
          } else {
            setAppState("fetching_channel");
            const info = await fetchChannelInfo();
            if (isMounted) {
              setChannelInfo(info);
              setAppState("unauthorized");
            }
          }
        }
      } catch (error) {
        const tgErr = (window as any).Telegram?.WebApp;
        logFrontend('AUTH_ERROR', { telegramId: tgErr?.initDataUnsafe?.user?.id ?? null, error: (error as Error).message });
        if (isMounted) {
          setAppState("fetching_channel");
          const info = await fetchChannelInfo();
          if (isMounted) {
            setChannelInfo(info);
            setAppState("unauthorized");
          }
        }
      }
    };

    // Добавлена искусственная задержка (500мс) чтобы моргание спиннера не было слишком быстрым
    const timerId = setTimeout(() => {
      checkAccess();
    }, 500);

    // Listen for custom recheck events
    window.addEventListener("auth:recheck", checkAccess);

    return () => {
      isMounted = false;
      clearTimeout(timerId);
      window.removeEventListener("auth:recheck", checkAccess);
    };
  }, []);

  if (MAINTENANCE_MODE) {
    return <Maintenance />;
  }

  if (appState === "telegram_only") {
    return <TelegramOnly />;
  }

  if (appState === "update_telegram") {
    return <UpdateTelegram />;
  }

  if (appState === "loading" || appState === "fetching_channel") {
    return <LoadingScreen />;
  }

  if (appState === "unauthorized") {
    return <SubscriptionRequired channelInfo={channelInfo} />;
  }

  return (
    <Routes>
      <Route path="/" element={<Catalog />} />
      <Route path="/pattern/:id" element={<PatternDetails />} />
      <Route path="/favorites" element={<Favorites />} />
    </Routes>
  );
}

export default App;
