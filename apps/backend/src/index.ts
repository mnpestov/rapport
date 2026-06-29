import "dotenv/config";
import express from "express";
import cors from "cors";
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
import internalRouter from "./routes/internal";
import diagRouter from "./routes/diag";

const uploadsDir = path.join(__dirname, "../uploads/patterns");
fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
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
app.use("/internal", internalRouter);
app.use("/diag", diagRouter);

app.listen(PORT, () => {
  console.log(`Backend is running on http://localhost:${PORT}`);
});
