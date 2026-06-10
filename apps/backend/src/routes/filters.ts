import { Router } from "express";
import { getFilters } from "../controllers/filtersController";

const router = Router();

router.get("/", getFilters);

export default router;
