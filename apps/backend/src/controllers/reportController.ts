import { Request, Response } from "express";
import { prisma } from "../prismaClient";

// Same convention as ADMIN_TELEGRAM_ID in scripts/check_price_updates.py and
// run_price_check.sh — plain Telegram user ids, not secrets, hardcoded
// rather than an env var so a new admin can be added with a one-line PR
// instead of a prod .env edit.
const REPORT_ADMIN_TELEGRAM_IDS = [486693505, 505293788];

const MAX_MESSAGE_LENGTH = 2000;

// Публичный веб-адрес карточки — тот же, что использует priceAlertNotifier
// для ссылок в уведомлениях о цене. Открывается в браузере, работает и вне
// Telegram.
const WEB_PATTERN_URL = "https://rapport.su/pattern";

// Собирает блок «о каком описании речь» для сообщения админам. По id из
// формы дотягивает из БД название, автора, ссылку на сайт автора и текущие
// price/isFree — чаще всего жалобы именно про них («описание платное», «цена
// не та»). Ошибку/отсутствие описания глотает: контекст — бонус, само
// обращение важнее.
async function buildPatternContext(patternId: unknown): Promise<string> {
  if (typeof patternId !== "string" || patternId.trim().length === 0) return "";
  try {
    const p = await prisma.pattern.findUnique({
      where: { id: patternId.trim() },
      select: {
        id: true,
        title: true,
        url: true,
        isFree: true,
        isVisible: true,
        price: true,
        oldPrice: true,
        author: { select: { name: true } },
      },
    });
    if (!p) return `\nОписание: id ${patternId.trim()} — не найдено в БД`;

    const priceStr = p.isFree
      ? "бесплатное"
      : p.price != null
        ? `${p.price}₽${p.oldPrice != null ? ` (старая ${p.oldPrice}₽)` : ""}`
        : "цена не указана";

    return (
      `\nОписание: «${p.title}» — ${p.author?.name ?? "автор не указан"}` +
      `\nЦена в базе: ${priceStr}${p.isVisible ? "" : " · в архиве"}` +
      `\nИсточник (сайт автора): ${p.url}` +
      `\nВ приложении: ${WEB_PATTERN_URL}/${p.id}`
    );
  } catch (error) {
    console.error("[Report] buildPatternContext failed:", error);
    return "";
  }
}

// POST /analytics/report-error (multipart/form-data: message, screenshot?)
// Delivers straight to the bot API — no DB persistence. The admins' Telegram
// chat with the bot IS the durable record, same reasoning notifyWhitelistUser
// (whitelistController.ts) and sendChatMessage (chatController.ts) rely on
// for the same gateway/BOT_TOKEN pattern, just fanned out to two chat ids
// instead of one.
export const submitErrorReport = async (req: Request, res: Response): Promise<void> => {
  const { message, patternId } = req.body ?? {};

  if (typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ error: `message must be at most ${MAX_MESSAGE_LENGTH} characters` });
    return;
  }

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    res.status(500).json({ error: "BOT_TOKEN not configured" });
    return;
  }
  const gatewayBase = process.env.TELEGRAM_GATEWAY_BASE_URL ?? "https://api.telegram.org";

  const telegramId = req.user!.telegramId;

  // Имя/username пользователя — чтобы админ мог ответить, не идя в БД.
  let userLabel = String(telegramId);
  try {
    const u = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { username: true, firstName: true },
    });
    if (u) {
      const parts = [u.firstName, u.username ? `@${u.username}` : null].filter(Boolean);
      if (parts.length > 0) userLabel = `${telegramId} (${parts.join(", ")})`;
    }
  } catch (error) {
    console.error("[Report] user lookup failed:", error);
  }

  const patternContext = await buildPatternContext(patternId);

  const text =
    `🐞 Сообщение об ошибке из Mini App` +
    `\nОт пользователя: ${userLabel}` +
    patternContext +
    `\n\n${message.trim()}`;
  const file = req.file;

  try {
    await Promise.all(
      REPORT_ADMIN_TELEGRAM_IDS.map(async (chatId) => {
        const msgRes = await fetch(`${gatewayBase}/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text }),
        });
        if (!msgRes.ok) {
          const err = await msgRes.json().catch(() => ({}));
          throw new Error(`sendMessage to ${chatId} failed: ${JSON.stringify(err)}`);
        }

        if (file) {
          const form = new FormData();
          form.append("chat_id", String(chatId));
          form.append("photo", new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), file.originalname || "screenshot.jpg");
          const photoRes = await fetch(`${gatewayBase}/bot${botToken}/sendPhoto`, {
            method: "POST",
            body: form,
          });
          if (!photoRes.ok) {
            const err = await photoRes.json().catch(() => ({}));
            throw new Error(`sendPhoto to ${chatId} failed: ${JSON.stringify(err)}`);
          }
        }
      })
    );

    res.status(201).json({ ok: true });
  } catch (error) {
    console.error("[Report] Failed to deliver error report:", error);
    res.status(502).json({ error: "Failed to deliver report" });
  }
};
