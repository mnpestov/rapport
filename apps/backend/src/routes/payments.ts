import { Router } from "express";
import express from "express";
import { requireAuth } from "../middlewares/auth";
import { createPayment, handleRobokassaResult } from "../controllers/paymentsController";

const router = Router();

router.post("/create", requireAuth, createPayment);

// Result URL — вызывается сервером Robokassa напрямую, без JWT-заголовка,
// и шлёт тело как application/x-www-form-urlencoded, не JSON (глобально в
// index.ts подключён только express.json()) — поэтому urlencoded-парсер
// подключён именно здесь, не на всё приложение.
router.post("/robokassa/result", express.urlencoded({ extended: true }), handleRobokassaResult);

export default router;
