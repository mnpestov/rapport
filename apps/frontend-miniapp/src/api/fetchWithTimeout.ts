/**
 * Wrapper around fetch() that aborts after a specified timeout.
 * Prevents requests from hanging forever when users are behind a proxy.
 */

// DIAG: remove after investigation ↓
import { diagLog } from "../lib/diagnosticLogger";
// DIAG: remove after investigation ↑

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 10000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    // DIAG: skip logging the diag endpoint itself to avoid recursion
    if (!url.includes("/diag/")) {
      const isTimeout = err instanceof Error && err.name === "AbortError";
      diagLog(
        isTimeout ? "FETCH_TIMEOUT" : "FETCH_ERROR",
        url,
        {
          error: String(err),
          isTimeout,
          timeoutMs,
        }
      );
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}

