import type { DiagnosticResponse } from '@knitting/shared';

const TIMEOUT_MS = 10_000;

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
}
