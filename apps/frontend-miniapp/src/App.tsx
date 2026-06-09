import React, { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Catalog } from './pages/Catalog/Catalog';
import { PatternDetails } from './pages/PatternDetails/PatternDetails';
import { LoadingScreen } from './pages/LoadingScreen/LoadingScreen';
import { SubscriptionRequired } from './pages/SubscriptionRequired/SubscriptionRequired';
import { authenticate } from './api/authApi';

type AppState = "loading" | "unauthorized" | "authorized";

function App() {
  const [appState, setAppState] = useState<AppState>("loading");

  useEffect(() => {
    let isMounted = true;

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
    </Routes>
  );
}

export default App;
