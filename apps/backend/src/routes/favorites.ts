import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import {
  getFavorites,
  addFavorite,
  removeFavorite,
  importFavorites,
} from "../controllers/favoritesController";

const router = Router();

// All routes require authentication
router.use(requireAuth);

router.get("/", getFavorites);
router.post("/import", importFavorites);
router.post("/:patternId", addFavorite);
router.delete("/:patternId", removeFavorite);

export default router;
