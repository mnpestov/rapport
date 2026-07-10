import { Router } from "express";
import { Permission } from "@prisma/client";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/requirePermission";
import {
  getAuthorMe,
  getAuthorPatterns,
  createDraft,
  createEditDraft,
  updateDraft,
  submitDraft,
  getDraft,
} from "../controllers/authorController";

const router = Router();

// All author cabinet routes require a valid session + AUTHOR_CABINET permission.
router.use(requireAuth);
router.use(requirePermission(Permission.AUTHOR_CABINET));

router.get("/me", getAuthorMe);
router.get("/patterns", getAuthorPatterns);

router.get("/drafts/:id", getDraft);
router.post("/drafts", createDraft);
router.patch("/drafts/:id", updateDraft);
router.post("/drafts/:id/submit", submitDraft);

// Create an edit draft for an already-published pattern
router.post("/patterns/:id/edit", createEditDraft);

export default router;
