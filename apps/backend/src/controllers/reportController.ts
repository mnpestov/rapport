import { Request, Response } from "express";

// Same convention as ADMIN_TELEGRAM_ID in scripts/check_price_updates.py and
// run_price_check.sh — plain Telegram user ids, not secrets, hardcoded
// rather than an env var so a new admin can be added with a one-line PR
// instead of a prod .env edit.
const REPORT_ADMIN_TELEGRAM_IDS = [486693505, 505293788];

const MAX_MESSAGE_LENGTH = 2000;

// POST /analytics/report-error (multipart/form-data: message, screenshot?)
// Delivers straight to the bot API — no DB persistence. The admins' Telegram
// chat with the bot IS the durable record, same reasoning notifyWhitelistUser
// (whitelistController.ts) and sendChatMessage (chatController.ts) rely on
// for the same gateway/BOT_TOKEN pattern, just fanned out to two chat ids
// instead of one.
export const submitErrorReport = async (req: Request, res: Response): Promise<void> => {
  const { message } = req.body ?? {};

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
  const text = `🐞 Сообщение об ошибке из Mini App\nОт пользователя: ${telegramId}\n\n${message.trim()}`;
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
