/**
 * Wrapper around fetch() that aborts after a specified timeout.
 * Prevents requests from hanging forever when users are behind a proxy.
 */

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 10000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  // Propagate an external abort signal (e.g. from effect cleanup) into our
  // internal controller so both the timeout and the caller can cancel the request.
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

