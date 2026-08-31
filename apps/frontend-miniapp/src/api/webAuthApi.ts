import { API_URL } from './config';
import { setWebAccessToken, authorizedFetch } from './authSession';

/**
 * Клиент браузерного входа (BROWSER_ACCESS_PLAN.md §4.2, §4.6).
 *
 * Все запросы идут с credentials: 'include' — иначе браузер не примет
 * httpOnly-cookie с refresh-токеном, которую ставит сервер.
 */

export interface WebUser {
  id: string;
  telegramId: string;
  firstName: string;
  role?: 'USER' | 'AUTHOR' | 'ADMIN';
  authorId?: string | null;
  permissions?: string[];
}

export interface LoginSuccess {
  kind: 'success';
  token: string;
  user: WebUser;
}

export interface LoginMustChangePassword {
  kind: 'must_change_password';
  login: string;
}

export type LoginResult = LoginSuccess | LoginMustChangePassword;

// Строки ошибок бэкенда — стабильный контракт API, а не текст для
// пользователя (тот же приём, что в apps/admin/src/api/auth.ts).
// Переводим только те, до которых человек реально может дойти.
const ERROR_TEXT: Record<string, string> = {
  web_access_not_granted:
    'Вход в браузере пока открыт не для всех. Получите логин в боте @rapportapp_bot — доступ придёт вместе с ним.',
  'Invalid credentials': 'Неверный логин или пароль',
  'Invalid or expired code': 'Неверный или устаревший код',
  'Too many failed attempts, try again later': 'Слишком много попыток. Попробуйте позже.',
  'Too many attempts, please try again later': 'Слишком много попыток. Попробуйте позже.',
  'Too many requests, please try again later': 'Слишком много запросов. Попробуйте через минуту.',
  'Please wait before requesting a new code': 'Код уже отправлен. Подождите минуту.',
  'Password is too long': 'Пароль слишком длинный',
  'Password must be 10-64 characters': 'Пароль должен быть от 10 до 64 символов',
  'Password must not match the login': 'Пароль не должен совпадать с логином',
  'New password must differ from the current one': 'Новый пароль должен отличаться от текущего',
};

export class WebAuthError extends Error {
  constructor(public readonly code: string) {
    super(ERROR_TEXT[code] ?? 'Не удалось выполнить вход. Попробуйте позже.');
    this.name = 'WebAuthError';
  }
}

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new WebAuthError(data.error ?? 'unknown');
  return data;
}

function acceptSession(data: any): LoginSuccess {
  setWebAccessToken(data.token);
  try {
    // usePremiumAccess читает премиум-флаги отсюда — без записи premium-UI
    // мигал бы до следующего обновления данных.
    localStorage.setItem('user_data', JSON.stringify(data.user));
  } catch {
    // приватный режим / заблокированное хранилище — не критично
  }
  window.dispatchEvent(new CustomEvent('auth:ready'));
  return { kind: 'success', token: data.token, user: data.user };
}

/** Вход по логину и паролю. */
export async function userLogin(login: string, password: string): Promise<LoginResult> {
  const data = await post('/auth/user-login', { login, password });
  // Временный пароль — сессия ещё не выдана, сервер требует сменить его.
  if (data.mustChangePassword) {
    return { kind: 'must_change_password', login: data.login };
  }
  return acceptSession(data);
}

/** Смена временного пароля; в случае успеха сразу выдаётся сессия. */
export async function userChangePassword(
  login: string,
  currentPassword: string,
  newPassword: string,
): Promise<LoginSuccess> {
  const data = await post('/auth/user-change-password', { login, currentPassword, newPassword });
  return acceptSession(data);
}

/** Запрос одноразового кода в Telegram по @username. */
export async function requestCode(username: string): Promise<void> {
  await post('/auth/request-code', { username });
}

/** Вход по коду из Telegram. */
export async function verifyCode(username: string, code: string): Promise<LoginSuccess> {
  const data = await post('/auth/verify-code', { username, code });
  return acceptSession(data);
}

/** Запрос кода для сброса пароля. Ответ всегда одинаковый — см. бэкенд. */
export async function forgotPassword(login: string): Promise<void> {
  await post('/auth/forgot-password', { login });
}

/** Сброс пароля по коду из Telegram. Сессию не выдаёт — нужен обычный вход. */
export async function resetPassword(login: string, code: string, newPassword: string): Promise<void> {
  await post('/auth/reset-password', { login, code, newPassword });
}

/**
 * Явная перепроверка подписки на канал.
 *
 * Кнопка «Проверить подписку» и суточный фоновый триггер. Не защита —
 * защита в enforceWebSubscription на сервере; это способ не ждать
 * истечения серверного кэша, когда человек только что подписался.
 */
export async function subscriptionRecheck(): Promise<boolean | null> {
  const res = await authorizedFetch(`${API_URL}/auth/subscription-recheck`, {
    method: 'POST',
    credentials: 'include',
  });
  // null — «спросить не удалось», это НЕ то же самое, что «не подписан».
  // Эндпоинт лимитирован (1/мин, он всегда ходит в telegram-gateway), и
  // при 429 раньше возвращался false — приложение показывало экран
  // подписки подписанному человеку просто за то, что он дважды обновил
  // страницу. Решение об отказе принимает сервер на защищённых роутах
  // (enforceWebSubscription), а не этот вызов.
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.isSubscriber === true;
}
