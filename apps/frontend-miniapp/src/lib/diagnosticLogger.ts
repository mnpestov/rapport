/**
 * DIAGNOSTIC LOGGER — temporary, remove after investigation.
 *
 * Singleton that collects client-side diagnostic events and sends them
 * to POST /diag/logs in batches. Never throws — all internal errors
 * are silently swallowed to avoid interfering with the app.
 */

import { API_URL } from "../api/config";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type DiagEventType =
  // Lifecycle
  | "APP_START"
  // Auth
  | "AUTH_START"
  | "AUTH_SUCCESS"
  | "AUTH_ERROR"
  // Catalog
  | "CATALOG_LOADED"
  | "CATALOG_LOAD_ERROR"
  // Pattern card
  | "CARD_LOADED"
  | "CARD_LOAD_ERROR"
  // Images
  | "IMAGE_LOAD_START"
  | "IMAGE_LOAD_SUCCESS"
  | "IMAGE_LOAD_ERROR"
  // Network
  | "FETCH_TIMEOUT"
  | "FETCH_ERROR"
  | "NETWORK_OFFLINE"
  | "NETWORK_ONLINE"
  // Errors
  | "UNCAUGHT_ERROR"
  | "UNHANDLED_REJECTION"
  | "REACT_ERROR_BOUNDARY";

type DiagLevel = "info" | "warn" | "error";

interface DeviceEnv {
  userAgent: string;
  tgPlatform: string;
  tgVersion: string;
  viewport: string;
  url: string;
  online: boolean;
  language: string;
}

interface DiagEvent {
  sessionId: string;
  userId?: string;
  ts: number;
  type: DiagEventType;
  level: DiagLevel;
  message: string;
  data?: Record<string, unknown>;
  env: DeviceEnv;
}

// ---------------------------------------------------------------------------
// Levels per event type
// ---------------------------------------------------------------------------

const EVENT_LEVELS: Record<DiagEventType, DiagLevel> = {
  APP_START: "info",
  AUTH_START: "info",
  AUTH_SUCCESS: "info",
  AUTH_ERROR: "error",
  CATALOG_LOADED: "info",
  CATALOG_LOAD_ERROR: "error",
  CARD_LOADED: "info",
  CARD_LOAD_ERROR: "error",
  IMAGE_LOAD_START: "info",
  IMAGE_LOAD_SUCCESS: "info",
  IMAGE_LOAD_ERROR: "error",
  FETCH_TIMEOUT: "error",
  FETCH_ERROR: "error",
  NETWORK_OFFLINE: "warn",
  NETWORK_ONLINE: "info",
  UNCAUGHT_ERROR: "error",
  UNHANDLED_REJECTION: "error",
  REACT_ERROR_BOUNDARY: "error",
};

// ---------------------------------------------------------------------------
// Logger state
// ---------------------------------------------------------------------------

const SESSION_LIMIT = 50; // max events per browser session
const BATCH_SIZE = 10;    // flush when queue reaches this size
const FLUSH_INTERVAL_MS = 3000;
const DIAG_URL = `${API_URL}/diag/logs`;

let sessionId = "";
let userId: string | undefined;
let env: DeviceEnv = {
  userAgent: "",
  tgPlatform: "",
  tgVersion: "",
  viewport: "",
  url: "",
  online: true,
  language: "",
};

let eventCount = 0;
let queue: DiagEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildEnv(): DeviceEnv {
  try {
    const tg = (window as any).Telegram?.WebApp;
    return {
      userAgent: navigator.userAgent,
      tgPlatform: tg?.platform ?? "unknown",
      tgVersion: tg?.version ?? "unknown",
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      url: window.location.href,
      online: navigator.onLine,
      language: navigator.language,
    };
  } catch {
    return env; // return whatever we have
  }
}

function flush(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queue.length === 0) return;

  const batch = queue.splice(0);
  const payload = JSON.stringify({ events: batch });

  console.log('[DIAG] flush start', batch.length);

  try {
    if (typeof navigator.sendBeacon === "function") {
      const blob = new Blob([payload], { type: "application/json" });
      console.log('[DIAG] sending');
      const sent = navigator.sendBeacon(DIAG_URL, blob);
      console.log('[DIAG] beacon result', sent);
      if (!sent) {
        console.log('[DIAG] fallback fetch');
        fetch(DIAG_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    } else {
      console.log('[DIAG] fallback fetch');
      fetch(DIAG_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Never propagate — diagnostics must not break the app
  }
}

function enqueue(event: DiagEvent): void {
  queue.push(event);
  if (queue.length >= BATCH_SIZE) {
    flush();
  } else if (flushTimer === null) {
    flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Call once at app startup (main.tsx). */
export function initDiagLogger(): void {
  if (initialized) return;
  initialized = true;

  try {
    sessionId =
      typeof crypto?.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    env = buildEnv();

    // Flush remaining events when the page is about to unload
    window.addEventListener("pagehide", flush, { once: true });
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  } catch {
    // silent
  }
}

/** Set userId after successful authentication. */
export function setDiagUserId(id: string | number | undefined): void {
  if (id !== undefined && id !== null) {
    userId = String(id);
  }
}

/** Log a diagnostic event. Safe to call before initDiagLogger(). */
export function diagLog(
  type: DiagEventType,
  message: string,
  data?: Record<string, unknown>
): void {
  try {
    if (!initialized) return;
    if (eventCount >= SESSION_LIMIT) return;
    eventCount++;

    enqueue({
      sessionId,
      userId,
      ts: Date.now(),
      type,
      level: EVENT_LEVELS[type],
      message,
      ...(data !== undefined ? { data } : {}),
      env: {
        ...env,
        // Refresh mutable fields on each event
        online: navigator.onLine,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      },
    });
  } catch {
    // Never propagate
  }
}
