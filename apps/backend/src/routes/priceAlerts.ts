import { Router } from "express";
import { Permission } from "@prisma/client";
import { requireAuth } from "../middlewares/auth";
import { enforceWebSubscription } from "../middlewares/enforceWebSubscription";
import { requirePermission } from "../middlewares/requirePermission";
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
// requirePermission (НЕ ...OrAdmin) — строго по разрешению, чтобы админ мог
// проверять включение/отключение тумблера «Подписка на цены» на самом себе.
// Согласовано с usePremiumAccess.priceAlert на фронте.
// Отказ → 403 { error: "Forbidden" }; фронт трактует это как «нет доступа →
// пустой список», не как subscription_required.
router.use(requirePermission(Permission.PRICE_ALERT));

router.get("/", getAlerts);
router.post("/:patternId", subscribeAlert);
router.delete("/:patternId", unsubscribeAlert);

export default router;
