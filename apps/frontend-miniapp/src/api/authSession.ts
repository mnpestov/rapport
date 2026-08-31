import { API_URL } from './config';
import { fetchWithTimeout } from './fetchWithTimeout';

/**
 * Единая точка работы с сессией для ДВУХ режимов приложения
 * (BROWSER_ACCESS_PLAN.md §3.4).
 *
 *                     Telegram Mini App          Браузер
 *   вход              initData -> /auth/telegram  логин/пароль или код
 *   access-токен      localStorage.jwt_token      переменная в памяти
 *   refresh           нет (перезаход в Telegram)  httpOnly cookie
 *
 * Почему access-токен в браузере держим в памяти, а не в localStorage: XSS
 * тогда не может его просто прочитать, а refresh лежит в httpOnly cookie,
 * недоступной JS вовсе. Плата — токен теряется при перезагрузке вкладки, но
 * он тут же восстанавливается тихим /auth/refresh по cookie.
 *
 * Mini App при этом ОСТАВЛЕН как был (localStorage): менять там схему ради
 * симметрии значило бы трогать работающий путь без нужды — refresh-токенов
 * в Telegram нет, приложение переавторизуется при каждом открытии.
 */

export type AppMode = 'telegram' | 'web';

/**
 * Открыто ли приложение внутри Telegram.
 *
 * Проверяем ФАКТ наличия свежего initData у SDK, а не косвенные признаки:
 *  - сам объект window.Telegram.WebApp есть ВСЕГДА (скрипт telegram-web-app.js
 *    подключён в index.html), поэтому его наличие ничего не доказывает;
 *  - initData из sessionStorage тоже не годится: он живёт 24 часа и
 *    остаётся в браузерной вкладке после того, как приложение однажды
 *    открывали из Telegram. Именно из-за него браузер попадал прямо в
 *    каталог мимо экрана входа.
 *
 * platform === 'unknown' — как SDK помечает себя вне клиента Telegram.
 */
export function detectMode(): AppMode {
  const tg = (window as any).Telegram?.WebApp;
  if (!tg) return 'web';
  if (tg.platform && tg.platform !== 'unknown') return 'telegram';
  // Платформа неизвестна: доверяем только initData, полученному от SDK
  // прямо сейчас (не восстановленному из хранилища).
  return tg.initData ? 'telegram' : 'web';
}

// Режим определяется один раз при старте и дальше не меняется: он зависит
// от того, где открыто приложение, а не от состояния сессии.
let mode: AppMode = 'telegram';

// Access-токен веб-режима. В Mini App не используется — там источник
// localStorage (см. getAccessToken).
let webAccessToken: string | null = null;

export function initAuthSession(detectedMode: AppMode): void {
  mode = detectedMode;
}

export function getMode(): AppMode {
  return mode;
}

export function isWebMode(): boolean {
  return mode === 'web';
}

export function setWebAccessToken(token: string | null): void {
  webAccessToken = token;
}

export function getAccessToken(): string | null {
  return mode === 'web' ? webAccessToken : localStorage.getItem('jwt_token');
}

/**
 * Есть ли вообще сессия.
 *
 * Отдельно от getAccessToken(), потому что вызывающим (FavoritesContext)
 * важен факт авторизации, а не сам токен: раньше там стояла прямая проверка
 * localStorage, которая в веб-режиме всегда давала false и молча отключала
 * синхронизацию избранного.
 */
export function hasSession(): boolean {
  return getAccessToken() !== null;
}

// Совместимость со старым кодом: часть api-модулей собирала заголовки
// вручную. Оставлено для точечных вызовов, но предпочтительнее
// authorizedFetch — он умеет ещё и обновлять протухший токен.
export const getAuthHeaders = (): Record<string, string> => {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// ---------------------------------------------------------------------------
// Обновление токена (только веб-режим)
// ---------------------------------------------------------------------------

// Single-flight: параллельные 401 ждут один общий запрос обновления, иначе
// каждый из них ротировал бы refresh-токен и они гасили бы друг друга.
let refreshPromise: Promise<string | null> | null = null;

export async function refreshWebSession(): Promise<string | null> {
  if (mode !== 'web') return null;
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        // Оба заголовка — часть CSRF-защиты эндпоинта на бэкенде
        // (webAuthController.refresh проверяет и X-Requested-With, и Origin).
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!res.ok) {
        webAccessToken = null;
        return null;
      }
      const data = await res.json();
      webAccessToken = data.token ?? null;
      return webAccessToken;
    } catch {
      // Сеть отвалилась — токен не трогаем: возможно, он ещё живой, и
      // сбрасывать сессию из-за одного неудачного запроса не за что.
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function logoutWeb(): Promise<void> {
  webAccessToken = null;
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
  } catch {
    // Токен уже забыт локально; серверный отзыв — best-effort.
  }
  try {
    localStorage.removeItem('user_data');
  } catch {
    // приватный режим / заблокированное хранилище
  }
}

// ---------------------------------------------------------------------------
// События для App.tsx
// ---------------------------------------------------------------------------

/**
 * Сервер сообщил, что подписка на канал больше не действует
 * (403 subscription_required от enforceWebSubscription).
 *
 * Диспатчится событием, а не пробрасывается через возвращаемое значение:
 * поймать это может любой из десятка вызовов api, а обработать должен один
 * App.tsx — он переводит приложение на экран «нужна подписка».
 */
export const SUBSCRIPTION_REQUIRED_EVENT = 'auth:subscription-required';

/** Сессия недействительна (401 и обновить не удалось) — нужен перелогин. */
export const SESSION_EXPIRED_EVENT = 'auth:session-expired';

function emit(name: string): void {
  window.dispatchEvent(new CustomEvent(name));
}

// ---------------------------------------------------------------------------
// authorizedFetch
// ---------------------------------------------------------------------------

/**
 * Обёртка над fetch для всех авторизованных запросов приложения.
 *
 * Помимо привычного «401 -> обновить токен -> повторить» разбирает 403 с
 * телом от бэкенда: подписка отозвана и веб-доступ не выдан — разные
 * состояния, и приложение реагирует на них по-разному.
 */
export async function authorizedFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10000,
): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res = await fetchWithTimeout(url, { ...init, headers }, timeoutMs);

  // 401 в веб-режиме — повод попробовать тихо обновить токен по cookie.
  if (res.status === 401 && mode === 'web') {
    const newToken = await refreshWebSession();
    if (!newToken) {
      emit(SESSION_EXPIRED_EVENT);
      return res;
    }
    const retryHeaders = new Headers(init.headers);
    retryHeaders.set('Authorization', `Bearer ${newToken}`);
    res = await fetchWithTimeout(url, { ...init, headers: retryHeaders }, timeoutMs);
  }

  if (res.status === 403) {
    // Тело читаем с клона: оригинальный res отдаётся вызывающему, и его
    // поток должен остаться непрочитанным.
    const body = await res.clone().json().catch(() => null);
    if (body?.error === 'subscription_required') {
      emit(SUBSCRIPTION_REQUIRED_EVENT);
    }
  }

  return res;
}
