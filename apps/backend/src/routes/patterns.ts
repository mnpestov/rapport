import { Router } from "express";
import { getPatterns, getPatternById, getPatternsByIds, getSimilarPatterns } from "../controllers/patternsController";
import { resolveRole } from "../middlewares/resolveRole";
import { enforceWebSubscription } from "../middlewares/enforceWebSubscription";

const router = Router();

// Attaches req.userRole (null for guests/regular users) so the handlers
// below can omit premium fields (price/oldPrice/details, full images[]) for
// anyone who isn't ADMIN — see PAID_TIER_ROLLOUT_PLAN.md.
router.use(resolveRole);
// Браузерная сессия без действующей подписки на канал дальше не проходит
// (BROWSER_ACCESS_PLAN.md §3.3). Для гостей и Mini App — no-op.
router.use(enforceWebSubscription);

router.get("/", getPatterns);
router.post("/batch", getPatternsByIds);
router.get("/:id/similar", getSimilarPatterns);
router.get("/:id", getPatternById);

export default router;
