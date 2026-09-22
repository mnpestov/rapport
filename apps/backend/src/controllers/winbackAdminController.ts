/**
 * Список ответов на winback-опрос для админки — вкладка "Winback" на
 * странице Обращения (план в чате, сентябрь 2026). Две записи одного
 * события живут в разных таблицах:
 *   - WinbackResponse — сама причина (кнопка, которую нажали), всегда есть;
 *   - BotInboundMessage с messageType `winback_feedback:<step>` —
 *     свободный текст, есть только для веток DIDNT_FIND_PATTERN/HARD_TO_USE
 *     (ALL_GOOD не запрашивает текст вообще, см. winback.ts на боте).
 * Соединяем по (userId → telegramId, ближайшее по времени сообщение после
 * ответа) — свободный текст всегда приходит ПОСЛЕ кнопки в одном и том же
 * диалоге, поэтому "ближайшее bim.createdAt >= WinbackResponse.createdAt"
 * достаточно, точного окна не нужно: следующий ответ того же типа для
 * того же пользователя может случиться только в следующем цикле
 * неактивности, недели спустя.
 */
import { Request, Response } from "express";
import { prisma } from "../prismaClient";

const REASON_TO_FEEDBACK_TYPE: Record<string, string> = {
  DIDNT_FIND_PATTERN: "winback_feedback:didnt_find",
  HARD_TO_USE: "winback_feedback:hard_to_use",
};

export const getWinbackResponses = async (_req: Request, res: Response): Promise<void> => {
  const responses = await prisma.winbackResponse.findMany({
    orderBy: { createdAt: "desc" },
    include: { user: { select: { telegramId: true, username: true, firstName: true, lastName: true } } },
  });

  // Текст фидбека подтягиваем по одному запросу на "переписку", не на
  // каждый ответ отдельно — обычно тут десятки записей за раз, не тысячи,
  // N+1 тут не страшен, но пусть будет один findFirst на строку для
  // простоты: тот же паттерн, что и в остальном коде проекта (не
  // оптимизируем раньше, чем это реально понадобится).
  const items = await Promise.all(
    responses.map(async (r) => {
      const feedbackType = REASON_TO_FEEDBACK_TYPE[r.reason];
      const feedbackMessage = feedbackType
        ? await prisma.botInboundMessage.findFirst({
            where: {
              telegramId: r.user.telegramId,
              messageType: feedbackType,
              createdAt: { gte: r.createdAt },
            },
            orderBy: { createdAt: "asc" },
            select: { text: true, createdAt: true },
          })
        : null;

      return {
        id: r.id,
        telegramId: r.user.telegramId.toString(),
        username: r.user.username,
        firstName: r.user.firstName,
        lastName: r.user.lastName,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
        feedbackText: feedbackMessage?.text ?? null,
      };
    })
  );

  res.json(items);
};
