import { Router } from "express";
import { Permission } from "@prisma/client";
import { requireAuth } from "../middlewares/auth";
import { enforceWebSubscription } from "../middlewares/enforceWebSubscription";
import { requirePermissionOrAdmin } from "../middlewares/requirePermission";
import {
  getAlerts,
  subscribeAlert,
  unsubscribeAlert,
} from "../controllers/priceAlertsController";

const router = Router();

router.use(requireAuth);
// Веб-гейт — как у favorites: веб-пользователь без активной подписки на
// канал не должен трогать price-alerts.
router.use(enforceWebSubscription);
// requirePermissionOrAdmin (не requirePermission) — чтобы у администратора
// UI и API были согласованы (isAdmin || PRICE_ALERT в хуке фронта).
// Отказ → 403 { error: "Forbidden" }; фронт трактует это как «нет доступа →
// пустой список», не как subscription_required.
router.use(requirePermissionOrAdmin(Permission.PRICE_ALERT));

router.get("/", getAlerts);
router.post("/:patternId", subscribeAlert);
router.delete("/:patternId", unsubscribeAlert);

export default router;
