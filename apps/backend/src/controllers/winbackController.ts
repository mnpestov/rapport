/**
 * Ответы на winback-опрос (план в чате, сентябрь 2026) — дёргается
 * support-bot'ом при нажатии кнопки под сообщением checkWinback.ts.
 */
import { Request, Response } from "express";
import { WinbackReason } from "@prisma/client";
import { prisma } from "../prismaClient";

const VALID_REASONS = new Set(Object.values(WinbackReason));

// POST /internal/bot/winback/response — пользователь выбрал причину
// ("не нашла описание" / "сложно пользоваться" / "всё хорошо"). Пишем
// строку в WinbackResponse, а не апдейт поля на User — см. комментарий у
// модели в schema.prisma, история ответов важнее последнего значения.
export async function recordWinbackResponse(req: Request, res: Response): Promise<void> {
  const { telegramId, reason } = req.body;

  if (typeof telegramId !== "number") {
    res.status(400).json({ error: "telegramId must be a number" });
    return;
  }
  if (typeof reason !== "string" || !VALID_REASONS.has(reason as WinbackReason)) {
    res.status(400).json({ error: `reason must be one of: ${[...VALID_REASONS].join(", ")}` });
    return;
  }

  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) }, select: { id: true } });
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await prisma.winbackResponse.create({
    data: { userId: user.id, reason: reason as WinbackReason },
  });
  res.json({ ok: true });
}

const WINBACK_BONUS_DAYS = 14;

// POST /internal/bot/winback/grant-bonus — +14 дней подписки за
// развёрнутый отзыв в ветке "сложно пользоваться" (решено в чате,
// сентябрь 2026: выдаём автоматически по факту текста, без модерации —
// "если отзыв будет спамом, сможем отозвать"). Продление "с запасом", тот
// же паттерн блокировки строки, что и в paymentCompletion.ts: если срок
// ещё не истёк, 14 дней добавляются поверх него, а не поверх now().
export async function grantWinbackBonus(req: Request, res: Response): Promise<void> {
  const { telegramId } = req.body;

  if (typeof telegramId !== "number") {
    res.status(400).json({ error: "telegramId must be a number" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) }, select: { id: true } });
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const now = new Date();
  let newExpiresAt: Date;

  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ premiumExpiresAt: Date | null }[]>`
      SELECT "premiumExpiresAt" FROM "User" WHERE id = ${user.id} FOR UPDATE
    `;
    const lockedExpiresAt = locked[0]?.premiumExpiresAt ?? null;
    const basis = lockedExpiresAt && lockedExpiresAt > now ? lockedExpiresAt : now;
    newExpiresAt = new Date(basis.getTime() + WINBACK_BONUS_DAYS * 24 * 60 * 60 * 1000);

    await tx.user.update({ where: { id: user.id }, data: { premiumExpiresAt: newExpiresAt } });
  });

  res.json({ ok: true, newExpiresAt: newExpiresAt! });
}

// POST /internal/bot/winback/opt-out — "Не спрашивать больше". Постоянный
// отказ, checkWinback.ts исключает такого пользователя из будущих
// прогонов навсегда (см. winbackOptedOutAt в schema.prisma — не протухает,
// в отличие от winbackCheckinSentAt).
export async function optOutWinback(req: Request, res: Response): Promise<void> {
  const { telegramId } = req.body;

  if (typeof telegramId !== "number") {
    res.status(400).json({ error: "telegramId must be a number" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) }, select: { id: true } });
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { winbackOptedOutAt: new Date() } });
  res.json({ ok: true });
}
