import { Router } from "express";
import { telegramAuth } from "../controllers/authController";

const router = Router();

router.post("/telegram", telegramAuth);

export default router;
