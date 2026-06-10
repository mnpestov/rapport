import React, { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Catalog } from './pages/Catalog/Catalog';
import { PatternDetails } from './pages/PatternDetails/PatternDetails';
import { Favorites } from './pages/Favorites/Favorites';
import { LoadingScreen } from './pages/LoadingScreen/LoadingScreen';
import { SubscriptionRequired } from './pages/SubscriptionRequired/SubscriptionRequired';
import { authenticate } from './api/authApi';

type AppState = "loading" | "unauthorized" | "authorized";

function App() {
  const [appState, setAppState] = useState<AppState>("loading");

  useEffect(() => {
    let isMounted = true;

    // Инициализация Telegram Web App (Этап 1)
    try {
      const tg = (window as any).Telegram?.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();
        if (import.meta.env.DEV) {
          // TODO: удалить логирование персональных данных после финального тестирования Этапа 1
          console.log("[Telegram WebApp] initDataUnsafe:", tg.initDataUnsafe);
        }
      }
    } catch (e) {
      console.error("Failed to initialize Telegram WebApp", e);
    }

    const checkAccess = async () => {
      try {
        const response = await authenticate();
        if (isMounted) {
          setAppState(response.isSubscriber ? "authorized" : "unauthorized");
        }
      } catch (error) {
        if (isMounted) {
          setAppState("unauthorized"); // При ошибке сети блокируем доступ
        }
      }
    };

    // Добавлена искусственная задержка (500мс) чтобы моргание спиннера не было слишком быстрым
    setTimeout(() => {
      checkAccess();
    }, 500);

    return () => {
      isMounted = false;
    };
  }, []);

  if (appState === "loading") {
    return <LoadingScreen />;
  }

  if (appState === "unauthorized") {
    return <SubscriptionRequired />;
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
