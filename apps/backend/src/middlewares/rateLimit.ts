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

// POST /auth/author-login and /auth/author-change-password — same limiter
// shared between both (see implementation_plan.md §3.3: change-password must
// use the SAME rate limit as login, or it becomes a way to bypass the
// lockout entirely). Defense-in-depth by IP; the real brute-force defense is
// loginFailedAttempts in authorPasswordController.ts, keyed by login.
export const authorLoginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
});

// POST /auth/forgot-password — always responds 200 regardless of outcome, so
// this IP limit is the only thing bounding how many Telegram messages one
// requester can trigger across different logins.
export const forgotPasswordLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
});

// POST /auth/reset-password — analogous to verifyCodeLimiter above, for the
// password-reset OTP instead of the web-login OTP.
export const resetPasswordLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
});
