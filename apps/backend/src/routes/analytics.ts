import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import {
  recordPatternView,
  recordPatternLinkClick,
  recordSubscribeClick,
} from "../controllers/analyticsController";

const router = Router();

// All analytics endpoints require an authenticated user (userId from JWT).
router.use(requireAuth);

router.post("/pattern-view", recordPatternView);
router.post("/pattern-link-click", recordPatternLinkClick);
router.post("/subscribe-click", recordSubscribeClick);

export default router;
