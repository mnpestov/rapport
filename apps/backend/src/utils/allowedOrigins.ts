// Single source of truth for ADMIN_CORS_ORIGINS parsing — used both by the
// global cors() setup in index.ts and by the Origin/Referer guard on
// POST /auth/refresh (webAuthController.ts). Keeping one parse means the two
// checks can never drift apart on what counts as an allowed origin.
export const allowedOrigins: string[] = (process.env.ADMIN_CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
