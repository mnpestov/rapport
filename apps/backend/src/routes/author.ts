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
  deleteDraft,
  submitDraft,
  getDraft,
  archivePattern,
} from "../controllers/authorController";
import { createAuthorYarn } from "../controllers/yarnsController";

const router = Router();

// All author cabinet routes require a valid session + AUTHOR_CABINET permission.
router.use(requireAuth);
router.use(requirePermission(Permission.AUTHOR_CABINET));

router.get("/me", getAuthorMe);
router.get("/patterns", getAuthorPatterns);

router.get("/drafts/:id", getDraft);
router.post("/drafts", createDraft);
router.patch("/drafts/:id", updateDraft);
router.delete("/drafts/:id", deleteDraft);
router.post("/drafts/:id/submit", submitDraft);

// Create an edit draft for an already-published pattern
router.post("/patterns/:id/edit", createEditDraft);
router.post("/patterns/:id/archive", archivePattern);

router.post("/yarns", createAuthorYarn);

export default router;
