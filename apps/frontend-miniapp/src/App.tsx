import React, { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Catalog } from './pages/Catalog/Catalog';
import { PatternDetails } from './pages/PatternDetails/PatternDetails';
import { Favorites } from './pages/Favorites/Favorites';
import { Stash } from './pages/Stash/Stash';
import { StashSkeinDetails } from './pages/StashSkeinDetails/StashSkeinDetails';
import { TabBar } from './components/TabBar/TabBar';
import { LoadingScreen } from './pages/LoadingScreen/LoadingScreen';
import { SubscriptionRequired } from './pages/SubscriptionRequired/SubscriptionRequired';
import { Maintenance } from './pages/Maintenance/Maintenance';
import { authenticate } from './api/authApi';
import { Landing } from './pages/Landing/Landing';
import { UpdateTelegram } from './pages/UpdateTelegram/UpdateTelegram';
import { LoadError } from './pages/LoadError/LoadError';
import { PaymentSuccess } from './pages/PaymentSuccess/PaymentSuccess';
import { PaymentFail } from './pages/PaymentFail/PaymentFail';
import { PaywallModal, PaywallVariant } from './components/PaywallModal/PaywallModal';
import { WebLogin } from './pages/WebLogin/WebLogin';
import {
  detectMode,
  initAuthSession,
  refreshWebSession,
  isWebMode,
  SUBSCRIPTION_REQUIRED_EVENT,
  SESSION_EXPIRED_EVENT,
} from './api/authSession';
import { subscriptionRecheck } from './api/webAuthApi';
import { usePremiumAccess } from './hooks/usePremiumAccess';
import { initPwa } from './api/pwa';
import { submitPaywallImpression, submitPriceAlertIntroImpression, submitExpiringWarningImpression, PaywallSource } from './api/paywallApi';

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

// web_login — экран входа браузерной версии. Отдельное состояние, а не
// маршрут: до входа приложение вообще не должно рендерить каталог.
type AppState = "loading" | "fetching_channel" | "unauthorized" | "authorized" | "telegram_only" | "update_telegram" | "load_error" | "web_login";

function App() {
  // Считает глубину переходов внутри приложения — по ней кнопка «Назад» на
  // карточке описания решает, есть ли куда возвращаться. Вызов до любых
  // ранних return'ов: хук должен отработать на каждый рендер.
  useNavigationDepthTracker();

  // Период тестирования хранилища пряжи: доступ только ADMIN, независимо от
  // PREMIUM_YARN_STASH (фримиум-модель для всех — следующий этап, см. бэклог
  // "оплата подписки на хранилище"). Убрать это условие и вернуться к
  // access.yarnStash, когда тестирование закончится.
  const access = usePremiumAccess();
  const isStashTestingAccess = access.isAdmin;

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

        // Режим по detectMode() — теперь строго по свежему initData от SDK
        // (см. authSession.ts). tg.platform больше не учитывается: SDK
        // выставляет его и в Telegram-браузере, из-за чего сайт попадал в
        // каталог мимо гейта WEB_ACCESS.
        let mode = detectMode();

        let initData = tg?.initData || "";
        let restoredFromSession = false;

        // WebView-реролл: Telegram иногда переподнимает webview Mini App
        // заново уже без initData. Он всегда в пределах секунд-минут одной
        // сессии — восстанавливаем только реально свежий initData (< 10 мин
        // с момента, когда SDK его дал), иначе через сутки после
        // единственного открытия Mini App остаточный initData снова пускал
        // бы браузер в каталог.
        const TG_INITDATA_MAX_AGE_MS = 10 * 60 * 1000;
        if (mode === 'telegram') {
          if (initData) {
            sessionStorage.setItem('tg_initData', initData);
            sessionStorage.setItem('tg_initData_ts', String(Date.now()));
          } else {
            const stored = sessionStorage.getItem('tg_initData');
            const ts = Number(sessionStorage.getItem('tg_initData_ts') || 0);
            if (stored && Date.now() - ts < TG_INITDATA_MAX_AGE_MS) {
              initData = stored;
              restoredFromSession = true;
            } else if (stored) {
              // Протух — чистим, чтобы не мешал последующим заходам.
              sessionStorage.removeItem('tg_initData');
              sessionStorage.removeItem('tg_initData_ts');
            }
          }
        }

        // Медленный старт Mini App: на части клиентов Telegram initData
        // приходит от SDK не мгновенно. detectMode() без tg.platform в этот
        // момент вернёт 'web'. Даём SDK 1.5 с на появление initData, прежде
        // чем уходить в браузерный лендинг (симметрично retry ниже в
        // telegram-ветке). tg?.platform здесь — только эвристика «окружение
        // телеграмное», а не признак Mini App.
        if (mode === 'web' && tg?.platform && tg.platform !== 'unknown' && !tg.initData) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          if (tg.initData) {
            mode = 'telegram';
            initData = tg.initData;
            sessionStorage.setItem('tg_initData', initData);
            sessionStorage.setItem('tg_initData_ts', String(Date.now()));
            logFrontend('AUTH_INITDATA_LATE', { initDataLength: initData.length });
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

        // Открыто в обычном браузере, не в Telegram. Раньше здесь безусловно
        // показывался лендинг «только в Telegram»; теперь пробуем поднять
        // браузерную сессию (BROWSER_ACCESS_PLAN.md §3.5).
        const enterWebMode = async (): Promise<void> => {
          initAuthSession('web');
          // Регистрируем Service Worker и включаем перехват промта установки
          // только здесь — точно в браузере, не в Telegram.
          initPwa();
          // Тихое восстановление по httpOnly-cookie: access-токен живёт в
          // памяти и теряется при перезагрузке вкладки, а refresh — нет.
          const token = await refreshWebSession();
          if (!isMounted) return;
          if (!token) {
            // Сессии нет — показываем лендинг с кнопкой «Войти», а не сразу
            // форму: до публичного запуска обычный посетитель не должен
            // видеть призыв входить, а описание возможностей должно
            // оставаться доступным (BROWSER_ACCESS_PLAN.md §3.5).
            setAppState("telegram_only");
            return;
          }
          // Сессия поднялась — пускаем в каталог. Подписку тут НЕ форсим:
          // сервер проверит её сам на первом же запросе к каталогу
          // (enforceWebSubscription) и, если она отвалилась, вернёт 403
          // subscription_required — его поймает authorizedFetch и переключит
          // экран.
          //
          // Раньше здесь стоял subscriptionRecheck(), и это ломало обычное
          // обновление страницы: эндпоинт лимитирован 1 запросом в минуту
          // (он всегда ходит в telegram-gateway), второе обновление подряд
          // получало 429 и человека выкидывало на экран подписки.
          setAppState("authorized");
        };

        // В обычном dev (`pnpm dev`) этот блок пропускается: ниже
        // подставляется initData="mock_dev" и приложение всегда уходит в
        // Telegram-ветку — так локально не нужен реальный Telegram. Из-за
        // этого браузерный режим (лендинг → вход → каталог) и PWA локально
        // никак не поднять. Флаг VITE_FORCE_WEB=true включает браузерный
        // путь в dev, не трогая прод (там переменной нет).
        const forceWeb = import.meta.env.VITE_FORCE_WEB === 'true';
        if (!import.meta.env.DEV || forceWeb) {
          // Устаревший клиент Telegram: SDK не загрузился, но UA говорит,
          // что мы внутри Telegram — тогда это не браузер, а старая версия.
          if (!tg && /Telegram/i.test(navigator.userAgent)) {
            const versionMatch = navigator.userAgent.match(/Telegram[^/]*\/(\d+)/i);
            const majorVersion = versionMatch ? parseInt(versionMatch[1], 10) : 0;
            if (majorVersion > 0 && majorVersion < 6) {
              logFrontend('AUTH_OUTDATED_TELEGRAM', {});
              if (isMounted) setAppState("update_telegram");
            } else {
              logFrontend('AUTH_SDK_LOAD_FAILED', {});
              if (isMounted) setAppState("load_error");
            }
            return;
          }

          if (mode === 'web') {
            logFrontend('AUTH_BROWSER_ACCESS', {});
            await enterWebMode();
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

        // Telegram-режим: источник токена — localStorage, как и был.
        initAuthSession('telegram');

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

  // Реакция на серверный энфорсмент подписки (BROWSER_ACCESS_PLAN.md §4.4).
  //
  // authorizedFetch диспатчит эти события, поймав 403/401 на ЛЮБОМ запросе:
  // ловить их в каждом вызове api невозможно, а обработать должен один
  // App.tsx — он и владеет appState.
  useEffect(() => {
    const onSubscriptionRequired = async () => {
      setAppState("fetching_channel");
      const info = await fetchChannelInfo();
      setChannelInfo(info);
      setAppState("unauthorized");
    };
    const onSessionExpired = () => {
      // Только веб: в Mini App сессия восстанавливается перезаходом через
      // Telegram, а не экраном логина.
      if (isWebMode()) setAppState("web_login");
    };

    window.addEventListener(SUBSCRIPTION_REQUIRED_EVENT, onSubscriptionRequired);
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => {
      window.removeEventListener(SUBSCRIPTION_REQUIRED_EVENT, onSubscriptionRequired);
      window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    };
  }, []);

  // Суточная фоновая перепроверка подписки для открытой вкладки.
  //
  // Это UX, а не защита: сервер всё равно проверит сам (enforceWebSubscription),
  // но вкладка может висеть открытой сутками, и без этого человек узнал бы
  // об отписке только при следующем запросе к каталогу.
  useEffect(() => {
    if (appState !== "authorized" || !isWebMode()) return;
    const RECHECK_MS = 24 * 60 * 60 * 1000;
    const timer = setInterval(() => {
      subscriptionRecheck().catch(() => {
        // Молча: следующий запрос к каталогу всё равно упрётся в сервер.
      });
    }, RECHECK_MS);
    return () => clearInterval(timer);
  }, [appState]);

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
    let subscriptionWarning: "expiring_3_days" | "expiring_1_day" | null = null;
    let showPriceAlertIntro = false;
    try {
      const raw = localStorage.getItem("user_data");
      const parsed = raw ? JSON.parse(raw) : null;
      showPaywallBanner = Boolean(parsed?.showPaywallBanner);
      const warning = parsed?.subscriptionWarning;
      if (warning === "expiring_3_days" || warning === "expiring_1_day") {
        subscriptionWarning = warning;
      }
      showPriceAlertIntro = Boolean(parsed?.showPriceAlertIntro);
    } catch {
      showPaywallBanner = false;
      subscriptionWarning = null;
      showPriceAlertIntro = false;
    }

    // Приоритет: предупреждение об истечении > баннер "оформите" >
    // разовое "новая функция" действующим подписчикам. Первые два на
    // практике не пересекаются (см. authController.ts) — это страховка.
    // showPriceAlertIntro отдельно взаимоисключающ с обоими по бэкенд-
    // условию (только hasExtra), но если у подписчика ОДНОВРЕМЕННО горит
    // subscriptionWarning и он ещё не видел intro — предупреждение важнее,
    // intro подождёт следующего входа (серверный флаг не гасится показом
    // другого баннера).
    if (!subscriptionWarning && !showPaywallBanner && !showPriceAlertIntro) return;

    if (!import.meta.env.DEV) sessionStorage.setItem("paywall_shown_session", "true");
    setPaywallSource(subscriptionWarning || showPaywallBanner ? "AUTO_BANNER" : "PRICE_ALERT_INTRO");
    setPaywallVariant(subscriptionWarning ?? (showPaywallBanner ? "paywall" : "price_alert_intro"));
    setIsPaywallOpen(true);
    // Аналитика показов (PAYWALL_BANNER_PLAN.md §7) отдельно от
    // функциональной отметки "показано" ниже — impression-эндпоинты пишут
    // разные поля на разные кулдауны, смешивать нельзя (см. их комментарии
    // в paywallController.ts).
    if (showPaywallBanner && !subscriptionWarning) {
      submitPaywallImpression();
    } else if (showPriceAlertIntro && !subscriptionWarning && !showPaywallBanner) {
      submitPriceAlertIntroImpression();
    } else if (subscriptionWarning) {
      submitExpiringWarningImpression(subscriptionWarning);
    }
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

  if (appState === "web_login") {
    return (
      <WebLogin
        onAuthenticated={async () => {
          // Вход прошёл — возвращаем человека туда, ради чего он входил:
          // в каталог. Подписку спрашиваем сразу, чтобы не показывать
          // каталог тому, кто отписался (сервер всё равно закроет его, но
          // мигание пустым списком выглядело бы поломкой).
          const ok = await subscriptionRecheck();
          // null — спросить не удалось (например, сработал лимит). Это не
          // повод показывать экран подписки: пускаем в каталог, а решение
          // примет сервер на первом же запросе.
          if (ok === false) {
            setAppState("fetching_channel");
            const info = await fetchChannelInfo();
            setChannelInfo(info);
            setAppState("unauthorized");
          } else {
            setAppState("authorized");
          }
        }}
      />
    );
  }

  if (appState === "telegram_only") {
    // Кнопка входа — только в браузере: внутри Telegram входить некуда,
    // там аккаунт уже задан мессенджером.
    return (
      <Landing
        onLoginClick={isWebMode() ? () => setAppState("web_login") : undefined}
      />
    );
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
        {/* Хранилище пряжи: в проде фримиум всем (лимит 10 артикулов + подбор
            описаний под PREMIUM_YARN_STASH), но на период тестирования роут
            и таб-бар видны только ADMIN — см. isStashTestingAccess выше. */}
        {isStashTestingAccess && <Route path="/stash" element={<Stash />} />}
        {isStashTestingAccess && <Route path="/stash/:id" element={<StashSkeinDetails />} />}
      </Routes>
      {isStashTestingAccess && <TabBar />}
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
