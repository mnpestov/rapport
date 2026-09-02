import type { DiagnosticResponse, AuthorApplicationStatusResponse } from '@knitting/shared';

const TIMEOUT_MS = 10_000;

// Thrown by submitAuthorApplication on a 4xx so the handler can show the
// backend's specific reason (e.g. "already pending", "24h cooldown") instead
// of a generic failure message — these are expected outcomes of a
// check-then-act race (status was checked when /become_author opened the
// dialog, but can change before submission), not backend bugs.
// Ожидаемые 4xx от эндпоинтов веб-учётки: логин занят, учётка уже есть.
// Отдельный класс, чтобы хендлер мог показать пользователю конкретную
// причину и предложить действие, а не «что-то пошло не так».
export class UserCredentialError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly login?: string,
  ) {
    super(code);
    this.name = 'UserCredentialError';
  }
}

export class AuthorApplicationError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    // Некоторые ответы несут логин (например credential_exists — уже
    // существующая учётка пользователя).
    public readonly login?: string,
  ) {
    super(message);
    this.name = 'AuthorApplicationError';
  }
}

export class BackendClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    const backendUrl = process.env.BACKEND_URL;
    const botApiKey = process.env.BACKEND_BOT_API_KEY;
    if (!backendUrl) throw new Error('[BackendClient] Missing env: BACKEND_URL');
    if (!botApiKey) throw new Error('[BackendClient] Missing env: BACKEND_BOT_API_KEY');
    this.baseUrl = backendUrl;
    this.apiKey = botApiKey;
  }

  async diagnose(
    userId: number,
    opts?: { username?: string; firstName?: string; lastName?: string },
  ): Promise<DiagnosticResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/internal/bot/diagnose`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-bot-api-key': this.apiKey,
        },
        body: JSON.stringify({ telegramId: userId, mode: 'diagnose-and-fix', ...opts }),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`[BackendClient] diagnose timed out after ${TIMEOUT_MS}ms`);
      }
      throw new Error(`[BackendClient] Network error: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 400 && response.status < 500) {
      const text = await response.text().catch(() => '');
      throw new Error(`[BackendClient] diagnose 4xx ${response.status}: ${text}`);
    }

    if (response.status >= 500) {
      throw new Error(`[BackendClient] diagnose 5xx ${response.status}`);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error('[BackendClient] diagnose returned invalid JSON');
    }

    return data as DiagnosticResponse;
  }

  async saveMessage(params: {
    telegramId: number;
    username?: string | null;
    firstName?: string | null;
    messageType: string;
    text?: string | null;
    fileId?: string | null;
  }): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      await fetch(`${this.baseUrl}/internal/bot/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bot-api-key': this.apiKey },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
    } catch {
      // fire-and-forget, never throw
    } finally {
      clearTimeout(timer);
    }
  }

  async escalate(userId: number): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/internal/bot/escalate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bot-api-key': this.apiKey },
        body: JSON.stringify({ telegramId: userId }),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`[BackendClient] escalate timed out after ${TIMEOUT_MS}ms`);
      }
      throw new Error(`[BackendClient] Network error: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`[BackendClient] escalate ${response.status}: ${text}`);
    }
  }

  // Шаг «логин» в диалоге заявки: проверяет формат и занятость логина и
  // закрепляет его за черновиком заявки (создаёт черновик, если его нет).
  // На занятый логин бросает AuthorApplicationError с message='login_taken'.
  // preexisting=true — у пользователя уже была учётка, логин взят из неё
  // (присланный проигнорирован).
  async reserveApplicationLogin(params: {
    telegramId: number;
    login: string;
    authorName: string;
    resources: string[];
  }): Promise<{ login: string; preexisting: boolean }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/internal/bot/author-application/reserve-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bot-api-key': this.apiKey },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`[BackendClient] reserveApplicationLogin timed out after ${TIMEOUT_MS}ms`);
      }
      throw new Error(`[BackendClient] Network error: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    const data = await response
      .json()
      .catch(() => ({}) as { error?: string; login?: string; preexisting?: boolean });
    if (!response.ok) {
      throw new AuthorApplicationError(
        response.status,
        data.error || `reserveApplicationLogin failed with ${response.status}`,
        data.login,
      );
    }
    return { login: data.login as string, preexisting: !!data.preexisting };
  }

  // Кнопка «Отмена» на сводке: удаляет черновик заявки, логин освобождается.
  // Тихо игнорирует отсутствие черновика.
  async discardApplicationDraft(telegramId: number): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      await fetch(`${this.baseUrl}/internal/bot/author-application/discard-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bot-api-key': this.apiKey },
        body: JSON.stringify({ telegramId }),
        signal: controller.signal,
      });
    } catch {
      // Best-effort: не смогли удалить черновик — его подберёт фоновая
      // уборка через сутки. Пользователю показывать нечего.
    } finally {
      clearTimeout(timer);
    }
  }

  // implementation_plan.md §4.2/§6 — telegramId in the body, not query
  // (query strings can end up in proxy access logs).
  //
  // Финальная отправка: заявка уже есть как черновик с закреплённым логином
  // (см. reserveApplicationLogin), здесь её переводят в «на рассмотрении».
  // login передаётся для сверки бэкендом с черновиком.
  async submitAuthorApplication(params: {
    telegramId: number;
    authorName: string;
    resources: string[];
    login: string;
  }): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/internal/bot/author-application`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bot-api-key': this.apiKey },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`[BackendClient] submitAuthorApplication timed out after ${TIMEOUT_MS}ms`);
      }
      throw new Error(`[BackendClient] Network error: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}) as { error?: string });
      throw new AuthorApplicationError(
        response.status,
        data.error || `submitAuthorApplication failed with ${response.status}`,
      );
    }
  }

  async getApplicationStatus(telegramId: number): Promise<AuthorApplicationStatusResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/internal/bot/author-application/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bot-api-key': this.apiKey },
        body: JSON.stringify({ telegramId }),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`[BackendClient] getApplicationStatus timed out after ${TIMEOUT_MS}ms`);
      }
      throw new Error(`[BackendClient] Network error: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 404) {
      // User record not found for this telegramId — shouldn't happen for a
      // user already talking to the bot, but treat like "never applied"
      // rather than throwing.
      return { status: null };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`[BackendClient] getApplicationStatus ${response.status}: ${text}`);
    }

    // { status: null } (never applied) or the full record — both valid,
    // never an empty/error response here.
    return (await response.json()) as AuthorApplicationStatusResponse;
  }

  // Replies to an existing NEEDS_INFO application in place (moves it back
  // to PENDING) instead of creating a duplicate one — see
  // authorApplicationController.ts's respondToApplication. The backend also
  // accepts additionalResources as a separate field, but the bot folds
  // everything (text and links alike) into one free-text reply, so it's
  // never sent from here.
  async respondToApplication(params: { telegramId: number; userResponse: string }): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/internal/bot/author-application/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bot-api-key': this.apiKey },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`[BackendClient] respondToApplication timed out after ${TIMEOUT_MS}ms`);
      }
      throw new Error(`[BackendClient] Network error: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}) as { error?: string });
      throw new AuthorApplicationError(
        response.status,
        data.error || `respondToApplication failed with ${response.status}`,
      );
    }
  }

  // POST /internal/bot/user-credentials — создать учётку для входа на сайт.
  // Пароль приходит в ответе ОДИН раз: на бэкенде хранится только его хэш.
  async createUserCredential(params: {
    telegramId: number;
    login: string;
    username?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  }): Promise<{ login: string; password: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/internal/bot/user-credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bot-api-key': this.apiKey },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`[BackendClient] createUserCredential timed out after ${TIMEOUT_MS}ms`);
      }
      throw new Error(`[BackendClient] Network error: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    const data = await response.json().catch(() => ({}) as any);
    if (!response.ok) {
      throw new UserCredentialError(response.status, data.error || 'unknown', data.login);
    }
    return data as { login: string; password: string };
  }

  // POST /internal/bot/user-credentials/lookup — «Мой логин».
  // null, если учётки ещё нет.
  async lookupUserCredential(
    telegramId: number,
  ): Promise<{ login: string; mustChangePassword: boolean } | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/internal/bot/user-credentials/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bot-api-key': this.apiKey },
        body: JSON.stringify({ telegramId }),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`[BackendClient] lookupUserCredential timed out after ${TIMEOUT_MS}ms`);
      }
      throw new Error(`[BackendClient] Network error: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`[BackendClient] lookupUserCredential failed with ${response.status}`);
    }
    return (await response.json()) as { login: string; mustChangePassword: boolean };
  }

}
