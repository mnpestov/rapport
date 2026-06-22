/**
 * DIAGNOSTIC ROUTE — temporary, remove after investigation.
 */

import { Router } from "express";
import { receiveLogs } from "../controllers/diagController";

const router = Router();

// POST /diag/logs  — no auth required (logger runs before auth)
router.post("/logs", receiveLogs);

export default router;
