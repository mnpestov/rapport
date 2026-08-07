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
import fs from "fs";
import path from "path";
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
import { startExpireNewPatternsJob } from "./jobs/expireNewPatterns";

const uploadsDir = path.join(__dirname, "../uploads/patterns");
fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = (process.env.ADMIN_CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);
app.use(cookieParser());
app.use(express.json());
app.use(softAuth);

// Раздача статических файлов из папки public
app.use(express.static(path.join(__dirname, "../public")));

// Раздача загруженных изображений
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

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

startExpireNewPatternsJob();

app.listen(PORT, () => {
  console.log(`Backend is running on http://localhost:${PORT}`);
});
