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
import { LoadError } from './pages/LoadError/LoadError';
import { PaymentSuccess } from './pages/PaymentSuccess/PaymentSuccess';
import { PaymentFail } from './pages/PaymentFail/PaymentFail';
import { PaywallModal, PaywallVariant } from './components/PaywallModal/PaywallModal';
import { submitPaywallImpression, PaywallSource } from './api/paywallApi';

function logFrontend(event: string, extra?: Record<string, unknown>) {
  const payload = { event, userAgent: navigator.userAgent, ...extra };
  fetch('/diag/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

import { fetchChannelInfo, ChannelInfo } from './api/channelApi';
import { useNavigationDepthTracker } from './hooks/useNavigationDepth';

const MAINTENANCE_MODE = false;

type AppState = "loading" | "fetching_channel" | "unauthorized" | "authorized" | "telegram_only" | "update_telegram" | "load_error";

function App() {
  // Считает глубину переходов внутри приложения — по ней кнопка «Назад» на
  // карточке описания решает, есть ли куда возвращаться. Вызов до любых
  // ранних return'ов: хук должен отработать на каждый рендер.
  useNavigationDepthTracker();

  const [appState, setAppState] = useState<AppState>("loading");
  const [channelInfo, setChannelInfo] = useState<ChannelInfo | null>(null);
  const [isPaywallOpen, setIsPaywallOpen] = useState(false);
  const [paywallVariant, setPaywallVariant] = useState<PaywallVariant>('paywall');
  const [premiumExpiresAt, setPremiumExpiresAt] = useState<string | null>(null);
  // Различает автопоказ и открытие кнопкой — для варианта 'paywall' по
  // самому варианту источник не определить (PAYMENTS_ROBOKASSA_PLAN.md §10.3).
  const [paywallSource, setPaywallSource] = useState<PaywallSource>('AUTO_BANNER');

  useEffect(() => {
    // Result-страницы после оплаты (Robokassa Success/Fail URL) открываются в
    // обычном браузере, не в Telegram — им не нужны ни Telegram-гейт, ни
    // авторизация. Выходим до всей остальной логики, чтобы не делать лишних
    // сетевых вызовов и не инициализировать Telegram WebApp на странице, где
    // это не имеет смысла.
    if (window.location.pathname === '/success' || window.location.pathname === '/fail') {
      return;
    }

    let isMounted = true;

    // Clear saved catalog filters on fresh app start
    try {
      sessionStorage.removeItem('catalog_search');
      sessionStorage.removeItem('catalog_free_filter');
      sessionStorage.removeItem('catalog_new_filter');
      sessionStorage.removeItem('catalog_advanced_filters');
    } catch (e) {
      logFrontend('AUTH_SESSIONSTORAGE_BLOCKED', { error: (e as Error).message });
    }

    // Инициализация Telegram Web App (Этап 1)
    try {
      const tg = (window as any).Telegram?.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();
        // Резкий свайп вниз по контенту Telegram трактовал как жест
        // сворачивания мини-аппа, и вместо прокрутки каталога приложение
        // закрывалось. Отключаем — свернуть по-прежнему можно, но только
        // потянув за заголовок, а не за содержимое.
        //
        // Опциональный вызов обязателен: метод появился в Bot API 7.7, а
        // приложение работает и на клиентах старше (см. ниже проверку
        // majorVersion < 6 и экран update_telegram). На старых клиентах
        // метода просто нет — тогда ничего не произойдёт, вместо падения
        // всей инициализации Telegram WebApp.
        tg.disableVerticalSwipes?.();
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
        let restoredFromSession = false;

        if (initData) {
          sessionStorage.setItem('tg_initData', initData);
        } else {
          const stored = sessionStorage.getItem('tg_initData');
          if (stored) {
            initData = stored;
            restoredFromSession = true;
          }
        }

        const telegramId = tg?.initDataUnsafe?.user?.id ?? null;
        logFrontend('AUTH_START', {
          telegramId,
          initDataLength: initData.length,
          tgExists: !!tg,
          tgVersion: tg?.version ?? null,
          platform: tg?.platform ?? null,
          restoredFromSession,
          navType: (window as any).navigation?.entries?.()[0]?.type ?? null,
          perfNavType: (performance as any)?.navigation?.type ?? null,
          hashLength: location.hash.length,
          pathname: location.pathname,
          referrer: document.referrer || null,
        });

        if (!import.meta.env.DEV) {
          if (!tg) {
            if (/Telegram/i.test(navigator.userAgent)) {
              const versionMatch = navigator.userAgent.match(/Telegram[^/]*\/(\d+)/i);
              const majorVersion = versionMatch ? parseInt(versionMatch[1], 10) : 0;
              if (majorVersion > 0 && majorVersion < 6) {
                logFrontend('AUTH_OUTDATED_TELEGRAM', {});
                if (isMounted) setAppState("update_telegram");
              } else {
                logFrontend('AUTH_SDK_LOAD_FAILED', {});
                if (isMounted) setAppState("load_error");
              }
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

  // Paywall banner — at most once per session, gated server-side on "not
  // paid, not shown in the last 7 days" (authController.ts, see
  // PAYWALL_BANNER_PLAN.md §4/§6.2). Fires once appState reaches
  // "authorized" — the same point <Routes> below starts rendering — so
  // localStorage.user_data (written synchronously by authenticate() before
  // appState flips) is already fresh. The sessionStorage guard is what
  // stops this from re-firing if the user leaves /pattern/:id and comes
  // back — appState doesn't change on route navigation, only on a fresh
  // auth run, but the effect itself would otherwise still see the same
  // "authorized" value and (without the guard) could re-open on strict-mode
  // double-invoke or an auth:recheck-triggered rerun.
  useEffect(() => {
    if (appState !== "authorized") return;

    // Skipped in DEV so the modal reopens on every reload while iterating
    // on it, instead of only once per browser tab — import.meta.env.DEV is
    // statically false in a production build, so this never applies there.
    if (!import.meta.env.DEV && sessionStorage.getItem("paywall_shown_session")) return;

    let showPaywallBanner = false;
    let subscriptionWarning: PaywallVariant | null = null;
    try {
      const raw = localStorage.getItem("user_data");
      const parsed = raw ? JSON.parse(raw) : null;
      showPaywallBanner = Boolean(parsed?.showPaywallBanner);
      const warning = parsed?.subscriptionWarning;
      if (warning === "expiring_3_days" || warning === "expiring_1_day") {
        subscriptionWarning = warning;
      }
    } catch {
      showPaywallBanner = false;
      subscriptionWarning = null;
    }

    // Предупреждение об истечении важнее баннера: у подписчика доступ ещё
    // есть, и предлагать ему "оформите подписку" вместо "продлите" было бы
    // неверно. На практике эти два состояния и так не пересекаются
    // (см. authController.ts), приоритет — страховка от такого показа.
    if (!subscriptionWarning && !showPaywallBanner) return;

    if (!import.meta.env.DEV) sessionStorage.setItem("paywall_shown_session", "true");
    setPaywallSource("AUTO_BANNER");
    setPaywallVariant(subscriptionWarning ?? "paywall");
    setIsPaywallOpen(true);
    // Аналитика показов — только про сам баннер (PAYWALL_BANNER_PLAN.md §7),
    // предупреждения об истечении в ней не участвуют.
    if (!subscriptionWarning) submitPaywallImpression();
  }, [appState]);

  // Ручное открытие шторки кнопкой в строке поиска (SubscriptionButton).
  // В отличие от автопоказа выше здесь нет ни серверного гейта, ни
  // ограничения "раз в сессию" — пользователь запросил её сам. Платному
  // показываем состояние подписки с датой, бесплатному — обычный баннер.
  useEffect(() => {
    const onOpenPaywall = (event: Event) => {
      // Источник приходит в detail — кнопка у поиска его не передаёт
      // (исторически событие было только её), а замки в шторке фильтров
      // шлют 'FILTER_LOCK', чтобы в воронке было видно, за какой именно
      // функцией пришёл человек.
      const source = (event as CustomEvent<{ source?: PaywallSource }>).detail?.source ?? 'SEARCH_BUTTON';
      let hasPaidTier = false;
      let expiresAt: string | null = null;
      try {
        const raw = localStorage.getItem("user_data");
        const parsed = raw ? JSON.parse(raw) : null;
        const permissions: string[] = parsed?.permissions ?? [];
        hasPaidTier = parsed?.role === "ADMIN" || permissions.includes("PREMIUM_EXTRA");
        expiresAt = parsed?.premiumExpiresAt ?? null;
      } catch {
        hasPaidTier = false;
      }
      setPremiumExpiresAt(expiresAt);
      setPaywallSource(source);
      setPaywallVariant(hasPaidTier ? "active" : "paywall");
      setIsPaywallOpen(true);
    };
    window.addEventListener("paywall:open", onOpenPaywall);
    return () => window.removeEventListener("paywall:open", onOpenPaywall);
  }, []);

  if (window.location.pathname === '/success') {
    return <PaymentSuccess />;
  }

  if (window.location.pathname === '/fail') {
    return <PaymentFail />;
  }

  if (MAINTENANCE_MODE) {
    return <Maintenance />;
  }

  if (appState === "telegram_only") {
    return <TelegramOnly />;
  }

  if (appState === "update_telegram") {
    return <UpdateTelegram />;
  }

  if (appState === "load_error") {
    return <LoadError />;
  }

  if (appState === "loading" || appState === "fetching_channel") {
    return <LoadingScreen />;
  }

  if (appState === "unauthorized") {
    return <SubscriptionRequired channelInfo={channelInfo} />;
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<Catalog />} />
        <Route path="/pattern/:id" element={<PatternDetails />} />
        <Route path="/favorites" element={<Favorites />} />
      </Routes>
      <PaywallModal
        isOpen={isPaywallOpen}
        variant={paywallVariant}
        premiumExpiresAt={premiumExpiresAt}
        source={paywallSource}
        onClose={() => setIsPaywallOpen(false)}
      />
    </>
  );
}

export default App;
