/**
 * DIAGNOSTIC LOGGING CONTROLLER
 * Temporary — remove after investigation is complete.
 *
 * POST /diag/logs
 * Accepts batched client events, applies rate limiting, writes to stdout.
 * Always responds 202 immediately so the client is never blocked.
 */

import { Request, Response } from "express";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiagEvent {
  sessionId: string;
  userId?: string;
  ts: number;
  type: string;
  level: "info" | "warn" | "error";
  message: string;
  data?: Record<string, unknown>;
  env?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Rate limiter — per sessionId, in-memory
// ---------------------------------------------------------------------------

const MAX_EVENTS_PER_SESSION = 200;
const WINDOW_MS = 10 * 60 * 1000; // 10 min
const MAX_EVENTS_PER_BATCH = 50;

interface SessionEntry {
  count: number;
  expiresAt: number;
}

const sessionCounts = new Map<string, SessionEntry>();

/** Returns how many events from `requested` are still within the quota. */
function checkRateLimit(sessionId: string, requested: number): number {
  const now = Date.now();
  let entry = sessionCounts.get(sessionId);

  if (!entry || entry.expiresAt < now) {
    entry = { count: 0, expiresAt: now + WINDOW_MS };
    sessionCounts.set(sessionId, entry);
  }

  const remaining = MAX_EVENTS_PER_SESSION - entry.count;
  const allowed = Math.min(requested, Math.max(0, remaining));
  entry.count += allowed;
  return allowed;
}

/** Periodic cleanup — called on every request (cheap enough for low traffic). */
function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [key, entry] of sessionCounts.entries()) {
    if (entry.expiresAt < now) sessionCounts.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Log file (optional — writes to diag.jsonl next to log.txt)
// ---------------------------------------------------------------------------

const LOG_FILE = path.join(__dirname, "../../diag.jsonl");

function appendToFile(line: string): void {
  // Use async append — never block the event loop (was appendFileSync)
  fs.appendFile(LOG_FILE, line + "\n", "utf8", () => {
    // ignore errors — stdout is the primary channel
  });
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export const receiveLogs = (req: Request, res: Response): void => {
  // Respond immediately — never block the client
  res.status(202).json({ ok: true });

  cleanupExpiredSessions();

  const { events } = req.body as { events?: unknown };
  if (!Array.isArray(events) || events.length === 0) return;

  // Hard cap per request
  const capped = (events as DiagEvent[]).slice(0, MAX_EVENTS_PER_BATCH);

  const sessionId =
    typeof capped[0]?.sessionId === "string" ? capped[0].sessionId : null;
  if (!sessionId) return;

  const allowed = checkRateLimit(sessionId, capped.length);
  if (allowed === 0) return;

  const toProcess = capped.slice(0, allowed);
  const clientIp = req.ip ?? "unknown";

  for (const event of toProcess) {
    const line = JSON.stringify({
      ...event,
      _receivedAt: new Date().toISOString(),
      _ip: clientIp,
    });
    // Primary: stdout — captured by pm2 / systemd / docker logs
    console.log("[DIAG]", line);
    // Secondary: dedicated file for easy grep
    appendToFile(line);
  }
};
