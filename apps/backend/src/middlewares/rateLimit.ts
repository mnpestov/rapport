import rateLimit from "express-rate-limit";

// IP-based, in-memory (default MemoryStore) — fine for a single rapport-api
// instance (pm2, no cluster mode; same assumption jobs/expireNewPatterns.ts
// and jobs/popularity.ts already make). Would need a shared store (e.g.
// Redis) if the backend ever runs as more than one process, since each
// process would otherwise count independently.
//
// This is defense-in-depth against basic spam/abuse by IP. It is NOT the
// primary defense against brute-forcing a specific login code — that's
// registerFailedAttempt in webAuthController.ts, keyed by telegramId, which
// an IP limit alone can't provide (CGNAT/botnets share or rotate IPs).

// POST /auth/verify-code — a handful of legitimate retries (typo, slow
// paste) is normal; double digits per minute from one IP is not.
export const verifyCodeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
});

// POST /auth/request-code — already has its own per-user 60s resend
// cooldown; this catches one IP cycling through many different usernames.
export const requestCodeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
});

// POST /auth/telegram — every call hits the Telegram subscription gateway
// and does a DB upsert; this bounds how much one IP can amplify that.
export const telegramAuthLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});
