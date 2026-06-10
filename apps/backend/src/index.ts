import "dotenv/config";
import express from "express";
import cors from "cors";
import healthRouter from "./routes/health";
import authRouter from "./routes/auth";
import patternsRouter from "./routes/patterns";
import filtersRouter from "./routes/filters";

const app = express();
const PORT = process.env.PORT || 3000;

import path from "path";

app.use(cors());
app.use(express.json());

// Раздача статических файлов из папки public
app.use(express.static(path.join(__dirname, "../public")));

// Глобальное логирование входящих запросов
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Подключение роутов
app.use("/", healthRouter);
app.use("/auth", authRouter);
app.use("/patterns", patternsRouter);
app.use("/filters", filtersRouter);

app.listen(PORT, () => {
  console.log(`Backend is running on http://localhost:${PORT}`);
});
