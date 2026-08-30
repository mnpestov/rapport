import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { createAuthorApplication, getMyApplication } from "../controllers/authorApplicationController";

const router = Router();

// Mini app — regular JWT auth, not the author cabinet's requirePermission
// (AUTHOR_CABINET): applying for author status is exactly what a user
// WITHOUT that permission yet needs to do.
router.use(requireAuth);

router.post("/", createAuthorApplication);
router.get("/me", getMyApplication);

export default router;
