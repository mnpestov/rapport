import { Request, Response } from "express";
import { PaywallEventType, PaywallSource } from "@prisma/client";
import { prisma } from "../prismaClient";
import { requestPlatform } from "../utils/requestPlatform";

// POST /analytics/paywall-impression — marks "shown now" for the 7-day gate
// (PAYWALL_BANNER_PLAN.md §4/§5.2). Оставлен как есть: это НЕ аналитика, а
// функциональное поле, на котором висит кулдаун показа. События воронки
// пишутся отдельно (submitPaywallEvent ниже) — смешивать их нельзя, иначе
// чистка статистики сломала бы логику показа (§10.1).
export const submitPaywallImpression = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const clicked = req.body?.clicked === true;

  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        lastPaywallShownAt: new Date(),
        ...(clicked ? { lastPaywallClickedAt: new Date() } : {}),
      },
    });
    res.status(204).end();
  } catch (error) {
    console.error("[Paywall] Failed to record impression:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /analytics/price-alert-intro-impression — тот же принцип, что
// submitPaywallImpression выше, но пишет ОТДЕЛЬНОЕ поле: priceAlertIntroShownAt
// не сбрасывает 7-дневный кулдаун обычного баннера и наоборот (см.
// комментарий у поля в schema.prisma). Разово выставляется и больше не
// меняется — buildPaywallState проверяет "=== null", а не давность.
export const submitPriceAlertIntroImpression = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { priceAlertIntroShownAt: new Date() },
    });
    res.status(204).end();
  } catch (error) {
    console.error("[Paywall] Failed to record price-alert-intro impression:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /analytics/expiring-warning-impression — { variant: "expiring_3_days"
// | "expiring_1_day" }. Тот же принцип, что submitPriceAlertIntroImpression:
// отдельные поля на этап, разово проставляются и больше не читаются как
// "давность" — buildPaywallState проверяет "=== null". Сбрасываются в null
// при каждом продлении подписки (completePayment), так что следующий цикл
// увидит предупреждение заново.
const EXPIRING_VARIANT_FIELD = {
  expiring_3_days: "expiring3DaysShownAt",
  expiring_1_day: "expiring1DayShownAt",
} as const;

export const submitExpiringWarningImpression = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const variant = req.body?.variant;

  if (typeof variant !== "string" || !(variant in EXPIRING_VARIANT_FIELD)) {
    res.status(400).json({ error: "Unknown variant" });
    return;
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { [EXPIRING_VARIANT_FIELD[variant as keyof typeof EXPIRING_VARIANT_FIELD]]: new Date() },
    });
    res.status(204).end();
  } catch (error) {
    console.error("[Paywall] Failed to record expiring-warning impression:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const EVENT_TYPES = new Set<string>(Object.values(PaywallEventType));
const SOURCES = new Set<string>(Object.values(PaywallSource));

// POST /analytics/paywall-event — append-only лог для воронки (§10.2).
// Клиент шлёт fire-and-forget, поэтому 400 он всё равно не увидит; валидация
// здесь для того, чтобы мусорное значение не попало в выборку и не исказило
// отчёт, а не ради ответа клиенту.
export const submitPaywallEvent = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { type, source } = req.body ?? {};

  if (typeof type !== "string" || !EVENT_TYPES.has(type)) {
    res.status(400).json({ error: "Unknown event type" });
    return;
  }
  if (typeof source !== "string" || !SOURCES.has(source)) {
    res.status(400).json({ error: "Unknown source" });
    return;
  }

  try {
    await prisma.paywallEvent.create({
      data: {
        userId,
        type: type as PaywallEventType,
        source: source as PaywallSource,
        // Откуда пришло событие — из браузера или Mini App (§4.5, P2).
        platform: requestPlatform(req),
      },
    });
    res.status(204).end();
  } catch (error) {
    console.error("[Paywall] Failed to record event:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
