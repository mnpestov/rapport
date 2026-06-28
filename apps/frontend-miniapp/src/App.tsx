import React, { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Catalog } from './pages/Catalog/Catalog';
import { PatternDetails } from './pages/PatternDetails/PatternDetails';
import { Favorites } from './pages/Favorites/Favorites';
import { LoadingScreen } from './pages/LoadingScreen/LoadingScreen';
import { SubscriptionRequired } from './pages/SubscriptionRequired/SubscriptionRequired';
import { Maintenance } from './pages/Maintenance/Maintenance';
import { authenticate } from './api/authApi';

import { fetchChannelInfo, ChannelInfo } from './api/channelApi';

const MAINTENANCE_MODE = false;

type AppState = "loading" | "fetching_channel" | "unauthorized" | "authorized";

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

        if (!initData && import.meta.env.DEV) {
          initData = "mock_dev";
        }

        if (!initData) {
          if (isMounted) setAppState("unauthorized");
          return;
        }

        const response = await authenticate(initData);
        if (isMounted) {
          if (response.isSubscriber) {
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
