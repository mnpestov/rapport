/**
 * Уведомления подписчикам об изменении цены описания
 * (implementation_plan.md — «Подписка на цены», вариант B).
 *
 * Одна точка рассылки. Дёргается из ВСЕХ мест, где меняется Pattern.price:
 *  - ручная правка админом в форме описания;
 *  - одобрение правки автора (approveDraft, только edit-ветка);
 *  - скрипт check_price_updates.py → POST /internal/bot/price-changed.
 *
 * Событие для уведомления (см. обсуждение решений):
 *  - снижение цены: было > стало, обе цены заданы, новая > 0;
 *  - переход в бесплатно: было платно, стало isFree.
 * Дедупликации нет — сколько снижений, столько уведомлений.
 *
 * Отправка через telegram-gateway `/send-message` (как subscriptionNotifier),
 * никогда не бросает. parse_mode НЕ используется — в тексте произвольное
 * название описания.
 */

import { prisma } from "../prismaClient";

async function sendViaGateway(telegramId: bigint, text: string): Promise<boolean> {
  const baseUrl = process.env.TELEGRAM_GATEWAY_BASE_URL;
  const apiKey = process.env.TELEGRAM_GATEWAY_API_KEY;

  if (!baseUrl || !apiKey) {
    console.log(`[PriceAlert] Gateway not configured — message for ${telegramId}:\n${text}`);
    return false;
  }

  try {
    const response = await fetch(`${baseUrl}/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Key": apiKey,
      },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ chatId: telegramId.toString(), text }),
    });

    if (!response.ok) {
      console.error(`[PriceAlert] Gateway API error: ${response.status} ${response.statusText}`);
      console.error("[PriceAlert] Details:", await response.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("[PriceAlert] Network error sending message to Gateway:", err);
    return false;
  }
}

// Целые рубли без ".0".
function formatPrice(value: number): string {
  return Math.round(value).toLocaleString("ru-RU");
}

const SITE = "https://rapport.su/pattern";

function dropText(title: string, oldPrice: number, newPrice: number, patternId: string): string {
  return (
    `💸 Цена снизилась!\n\n` +
    `«${title}»\n` +
    `Была: ${formatPrice(oldPrice)} ₽ → Стала: ${formatPrice(newPrice)} ₽\n\n` +
    `${SITE}/${patternId}`
  );
}

function freeText(title: string, patternId: string): string {
  return (
    `🎁 Описание стало бесплатным!\n\n` +
    `«${title}»\n\n` +
    `${SITE}/${patternId}`
  );
}

interface PriceChange {
  patternId: string;
  title: string;
  oldPrice: number | null;
  oldIsFree: boolean;
  newPrice: number | null;
  newIsFree: boolean;
}

// Есть ли повод уведомлять и каким текстом.
function buildMessage(c: PriceChange): string | null {
  // Было платно → стало бесплатно.
  if (c.newIsFree && !c.oldIsFree) {
    return freeText(c.title, c.patternId);
  }
  // Снижение фактической цены.
  if (
    !c.newIsFree &&
    c.oldPrice != null &&
    c.newPrice != null &&
    c.newPrice > 0 &&
    c.newPrice < c.oldPrice
  ) {
    return dropText(c.title, c.oldPrice, c.newPrice, c.patternId);
  }
  return null;
}

/**
 * Проверяет, было ли снижение/переход в бесплатно, и рассылает уведомления
 * подписчикам этого описания с активным разрешением PRICE_ALERT.
 * Никогда не бросает — вызывать fire-and-forget.
 */
export async function notifyPriceChange(change: PriceChange): Promise<void> {
  try {
    const message = buildMessage(change);
    if (!message) return;

    const alerts = await prisma.priceAlert.findMany({
      where: { patternId: change.patternId },
      include: {
        user: {
          select: {
            telegramId: true,
            permissions: {
              where: { permission: "PRICE_ALERT" },
              select: { id: true },
            },
          },
        },
      },
    });

    const eligible = alerts.filter((a) => a.user.permissions.length > 0);
    for (const alert of eligible) {
      await sendViaGateway(alert.user.telegramId, message);
    }

    if (eligible.length > 0) {
      console.log(
        `[PriceAlert] notified ${eligible.length} subscriber(s) for pattern ${change.patternId}`,
      );
    }
  } catch (err) {
    console.error("[PriceAlert] notifyPriceChange failed:", err);
  }
}
