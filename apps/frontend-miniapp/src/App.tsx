import React, { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Catalog } from './pages/Catalog/Catalog';
import { PatternDetails } from './pages/PatternDetails/PatternDetails';
import { Favorites } from './pages/Favorites/Favorites';
import { LoadingScreen } from './pages/LoadingScreen/LoadingScreen';
import { SubscriptionRequired } from './pages/SubscriptionRequired/SubscriptionRequired';
import { authenticate } from './api/authApi';
// DIAG: remove after investigation
import { diagLog, setDiagUserId } from './lib/diagnosticLogger';

import { fetchChannelInfo, ChannelInfo } from './api/channelApi';

type AppState = "loading" | "fetching_channel" | "unauthorized" | "authorized";

function App() {
  const [appState, setAppState] = useState<AppState>("loading");
  const [channelInfo, setChannelInfo] = useState<ChannelInfo | null>(null);

  useEffect(() => {
    let isMounted = true;

    // Clear saved catalog filters on fresh app start
    sessionStorage.removeItem('catalog_search');
    sessionStorage.removeItem('catalog_free_filter');
    sessionStorage.removeItem('catalog_advanced_filters');

    // Инициализация Telegram Web App (Этап 1)
    try {
      const tg = (window as any).Telegram?.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();
        if (import.meta.env.DEV) {
          console.log("[Telegram WebApp] initDataUnsafe:", tg.initDataUnsafe);
        }
      }
    } catch (e) {
      console.error("Failed to initialize Telegram WebApp", e);
    }

    const checkAccess = async () => {
      if (isMounted) setAppState("loading");
      // DIAG
      diagLog('AUTH_START', 'Starting authentication');
      try {
        const tg = (window as any).Telegram?.WebApp;
        let initData = tg?.initData || "";
        
        if (!initData && import.meta.env.DEV) {
          initData = "mock_dev";
        }

        const response = await authenticate(initData);
        if (isMounted) {
          if (response.isSubscriber) {
            // DIAG
            setDiagUserId(response.user?.telegramId);
            diagLog('AUTH_SUCCESS', 'User authenticated as subscriber', {
              userId: response.user?.telegramId,
            });
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
        // DIAG
        diagLog('AUTH_ERROR', error instanceof Error ? error.message : String(error));
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
    setTimeout(() => {
      checkAccess();
    }, 500);

    // Listen for custom recheck events
    window.addEventListener("auth:recheck", checkAccess);

    return () => {
      isMounted = false;
      window.removeEventListener("auth:recheck", checkAccess);
    };
  }, []);

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
