import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { enforceWebSubscription } from "../middlewares/enforceWebSubscription";
import {
  getFavorites,
  addFavorite,
  removeFavorite,
  importFavorites,
} from "../controllers/favoritesController";

const router = Router();

// All routes require authentication
router.use(requireAuth);
// Избранное — часть каталога, гейтится так же (BROWSER_ACCESS_PLAN.md §3.3).
router.use(enforceWebSubscription);

router.get("/", getFavorites);
router.post("/import", importFavorites);
router.post("/:patternId", addFavorite);
router.delete("/:patternId", removeFavorite);

export default router;
