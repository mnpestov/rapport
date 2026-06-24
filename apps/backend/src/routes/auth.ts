import { Router } from "express";
import { telegramAuth } from "../controllers/authController";
import { requestCode, verifyCode, getMe } from "../controllers/webAuthController";
import { requireAuth } from "../middlewares/auth";

const router = Router();

// Mini App auth — unchanged.
router.post("/telegram", telegramAuth);

// Web / admin auth via one-time Telegram codes.
router.post("/request-code", requestCode);
router.post("/verify-code", verifyCode);
router.get("/me", requireAuth, getMe);

export default router;
