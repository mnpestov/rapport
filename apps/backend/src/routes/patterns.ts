import { Router } from "express";
import { getPatterns, getPatternById, getPatternsByIds, getSimilarPatterns } from "../controllers/patternsController";
import { resolveRole } from "../middlewares/resolveRole";

const router = Router();

// Attaches req.userRole (null for guests/regular users) so the handlers
// below can omit premium fields (price/oldPrice/details, full images[]) for
// anyone who isn't ADMIN — see PAID_TIER_ROLLOUT_PLAN.md.
router.use(resolveRole);

router.get("/", getPatterns);
router.post("/batch", getPatternsByIds);
router.get("/:id/similar", getSimilarPatterns);
router.get("/:id", getPatternById);

export default router;
