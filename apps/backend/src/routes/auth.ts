import { Router } from "express";
import { telegramAuth } from "../controllers/authController";
import { requestCode, verifyCode, getMe, refresh, logout } from "../controllers/webAuthController";
import { authorLogin, authorChangePassword, forgotPassword, resetPassword } from "../controllers/authorPasswordController";
import { requireAuth } from "../middlewares/auth";
import {
  verifyCodeLimiter,
  requestCodeLimiter,
  telegramAuthLimiter,
  authorLoginLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
} from "../middlewares/rateLimit";

const router = Router();

// Mini App auth — unchanged.
router.post("/telegram", telegramAuthLimiter, telegramAuth);

// Web / admin auth via one-time Telegram codes.
router.post("/request-code", requestCodeLimiter, requestCode);
router.post("/verify-code", verifyCodeLimiter, verifyCode);
router.get("/me", requireAuth, getMe);

// Author cabinet — login/password alternative to the Telegram OTP flow
// above (same User, same /cabinet). See implementation_plan.md.
router.post("/author-login", authorLoginLimiter, authorLogin);
// Same limiter as author-login — a separate/looser one here would let an
// attacker bypass the login lockout via this endpoint instead.
router.post("/author-change-password", authorLoginLimiter, authorChangePassword);
router.post("/forgot-password", forgotPasswordLimiter, forgotPassword);
router.post("/reset-password", resetPasswordLimiter, resetPassword);

// Refresh token rotation and logout — no requireAuth (cookie-based).
router.post("/refresh", refresh);
router.post("/logout", logout);

export default router;
