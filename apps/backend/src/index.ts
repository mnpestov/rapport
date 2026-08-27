import "dotenv/config";

// Fail fast in production if any dev-only backdoors are active.
// DEV_BYPASS_ADMIN_AUTH skips all admin auth; ALLOW_DEV_AUTH allows
// login without a real Telegram signature and leaks OTP codes in responses.
if (process.env.NODE_ENV === "production") {
  if (process.env.DEV_BYPASS_ADMIN_AUTH === "true") {
    throw new Error(
      "[FATAL] DEV_BYPASS_ADMIN_AUTH must not be enabled in production. Remove it from the environment."
    );
  }
  if (process.env.ALLOW_DEV_AUTH === "true") {
    throw new Error(
      "[FATAL] ALLOW_DEV_AUTH must not be enabled in production. Remove it from the environment."
    );
  }
}

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import fs from "fs";
import path from "path";
import { allowedOrigins } from "./utils/allowedOrigins";
import { softAuth } from "./middlewares/softAuth";
import healthRouter from "./routes/health";
import authRouter from "./routes/auth";
import patternsRouter from "./routes/patterns";
import filtersRouter from "./routes/filters";
import favoritesRouter from "./routes/favorites";
import channelRouter from "./routes/channel";
import analyticsRouter from "./routes/analytics";
import adminRouter from "./routes/admin";
import authorRouter from "./routes/author";
import internalRouter from "./routes/internal";
import diagRouter from "./routes/diag";
import paymentsRouter from "./routes/payments";
import { startExpireNewPatternsJob } from "./jobs/expireNewPatterns";
import { startPopularityJob } from "./jobs/popularity";

const uploadsDir = path.join(__dirname, "../uploads/patterns");
fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
const PORT = process.env.PORT || 3000;

// Fail fast in production if ADMIN_CORS_ORIGINS is missing/empty — the cors
// fallback below (`origin: true`) reflects ANY Origin, and combined with
// `credentials: true` that turns cookie-based auth (POST /auth/refresh) into
// a same-site CSRF vector for any origin sharing this deploy's registrable
// domain. Same pattern as the DEV_BYPASS_ADMIN_AUTH/ALLOW_DEV_AUTH guard
// above — silently permissive is worse than refusing to start.
if (process.env.NODE_ENV === "production" && allowedOrigins.length === 0) {
  throw new Error(
    "[FATAL] ADMIN_CORS_ORIGINS must be set in production (comma-separated allowed origins). Refusing to start with an open CORS fallback."
  );
}

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);
// frameguard and CSP are both off: the mini-app is rendered inside an
// iframe by the Telegram client itself (both frameguard's default
// X-Frame-Options: SAMEORIGIN and helmet's default CSP frame-ancestors
// would block that). crossOriginResourcePolicy is also off: this same
// process serves pattern images (/images, /uploads) that the admin panel
// (a different origin — admin.rapport.su vs rapport.su) embeds directly in
// <img> tags — helmet's default `same-origin` CORP blocks exactly that,
// independently of the cors() config above (CORP is enforced by the
// browser regardless of CORS headers). Everything else helmet sets by
// default (X-Content-Type-Options, etc.) is safe to keep as-is. A properly
// scoped CSP is a separate, deliberate follow-up — not something to bolt on
// blind here.
app.use(
  helmet({
    frameguard: false,
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
    // Irrelevant for a pure API/static-asset backend with no HTML of its
    // own to embed things into, but disabled explicitly rather than left to
    // helmet's defaults — same reasoning as CORP above, just lower-risk.
    crossOriginEmbedderPolicy: false,
  })
);
app.use(cookieParser());
app.use(express.json());
app.use(softAuth);

// Раздача статических файлов из папки public (сейчас там только
// public/images/patterns — скрапнутые фото паттернов). Файл под данным
// именем никогда не перезаписывается новым содержимым в штатной работе
// (см. PATTERN_IMAGES_BACKFILL_PROCESS.md — новая фотогалерея всегда
// получает новые имена файлов, индекс/хэш считается заново от текущего
// состояния; единственное исключение — явная ручная процедура отката,
// которая перед перезаписью удаляет старый файл) — поэтому долгий
// immutable-кэш безопасен уже сейчас, не только после будущей миграции на
// контент-адресуемые имена.
const STATIC_CACHE_OPTIONS = { maxAge: "30d", immutable: true };
app.use(express.static(path.join(__dirname, "../public"), STATIC_CACHE_OPTIONS));

// Раздача загруженных изображений (ручная загрузка через админку,
// uuidv4()-имена — коллизий/перезаписи по имени не бывает в принципе, см.
// apps/backend/src/routes/admin.ts).
app.use("/uploads", express.static(path.join(__dirname, "../uploads"), STATIC_CACHE_OPTIONS));

// Глобальное логирование входящих запросов
app.use((req, res, next) => {
  const uid = req.user?.telegramId ?? "anon";
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} uid=${uid}`);
  next();
});

// Подключение роутов
app.use("/", healthRouter);
app.use("/auth", authRouter);
app.use("/patterns", patternsRouter);
app.use("/filters", filtersRouter);
app.use("/favorites", favoritesRouter);
app.use("/channel", channelRouter);
app.use("/analytics", analyticsRouter);
app.use("/admin", adminRouter);
app.use("/author", authorRouter);
app.use("/internal", internalRouter);
app.use("/diag", diagRouter);
app.use("/payments", paymentsRouter);

// Global error handler — must be registered after all routes. Catches
// anything passed to next(err) and any synchronous throw inside a route
// handler (Express 4 already funnels those here; only a rejected Promise
// from an async handler bypasses this and needs the unhandledRejection
// listener below instead).
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[UnhandledError]', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Last-resort net for a rejected Promise inside an async route handler with
// no try/catch of its own (Express 4 does not await handlers, so such a
// rejection never reaches the error-handling middleware above). On Node >=15
// an unhandled rejection crashes the process by default — logging instead
// keeps one bad request from taking down the whole backend. This is a
// safety net, not a substitute for fixing the underlying missing try/catch.
process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
});

startExpireNewPatternsJob();
startPopularityJob();

app.listen(PORT, () => {
  console.log(`Backend is running on http://localhost:${PORT}`);
});
