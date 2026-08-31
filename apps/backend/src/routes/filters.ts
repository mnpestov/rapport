import { Router } from "express";
import { getFilters } from "../controllers/filtersController";
import { resolveRole } from "../middlewares/resolveRole";
import { enforceWebSubscription } from "../middlewares/enforceWebSubscription";

const router = Router();

// Needed here (unlike v3, which deliberately left this route alone) because
// yarnRanges/density facets are PREMIUM_CORE-gated — see
// PAID_TIER_PERMISSIONS_PLAN.md §3.3.
router.use(resolveRole);
router.use(enforceWebSubscription);

router.get("/", getFilters);

export default router;
