import { Router } from "express";
import { getPatterns, getPatternById, getPatternsByIds } from "../controllers/patternsController";

const router = Router();

router.get("/", getPatterns);
router.post("/batch", getPatternsByIds);
router.get("/:id", getPatternById);

export default router;
