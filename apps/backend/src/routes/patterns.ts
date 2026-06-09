import { Router } from "express";
import { getPatterns, getPatternById } from "../controllers/patternsController";

const router = Router();

router.get("/", getPatterns);
router.get("/:id", getPatternById);

export default router;
