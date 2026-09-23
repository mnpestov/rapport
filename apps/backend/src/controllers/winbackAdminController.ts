/**
 * Список отправок winback-чекина для админки — вкладка "Winback" на
 * странице Обращения (план в чате, сентябрь 2026). Раньше показывал
 * только ОТВЕТЫ (WinbackResponse) — не было видно, кому вообще ушло
 * сообщение, что делало конверсию и масштаб непонятными (запрос
 * пользователя: "первые сообщения ушли, но в админке не видно кому").
 *
 * Источник строк — User.winbackCheckinSentAt (не WinbackResponse):
 * каждый пользователь с непустым полем получил чекин хотя бы раз. Поле
 * хранит только ПОСЛЕДНЮЮ отправку (checkWinback.ts перезаписывает его
 * при новом периоде неактивности), поэтому строка одна на пользователя,
 * не на отправку — это осознанное упрощение: полной истории отправок в
 * БД не хранится, только текущий снимок.
 *
 * Ответ (если есть) подтягивается LEFT JOIN-подобно: самый свежий
 * WinbackResponse пользователя, СОЗДАННЫЙ НЕ РАНЬШЕ последней отправки —
 * иначе ответ из предыдущего, уже неактуального цикла ошибочно выглядел
 * бы ответом на текущий чекин.
 */
import { Request, Response } from "express";
import { prisma } from "../prismaClient";

const REASON_TO_FEEDBACK_TYPE: Record<string, string> = {
  DIDNT_FIND_PATTERN: "winback_feedback:didnt_find",
  HARD_TO_USE: "winback_feedback:hard_to_use",
};

export const getWinbackResponses = async (_req: Request, res: Response): Promise<void> => {
  const sentUsers = await prisma.user.findMany({
    where: { winbackCheckinSentAt: { not: null } },
    orderBy: { winbackCheckinSentAt: "desc" },
    select: {
      id: true,
      telegramId: true,
      username: true,
      firstName: true,
      lastName: true,
      winbackCheckinSentAt: true,
      winbackOptedOutAt: true,
    },
  });

  // Тот же паттерн, что и раньше — по запросу на строку, не оптимизируем
  // раньше времени (десятки строк за раз, не тысячи).
  const items = await Promise.all(
    sentUsers.map(async (u) => {
      const response = await prisma.winbackResponse.findFirst({
        where: { userId: u.id, createdAt: { gte: u.winbackCheckinSentAt! } },
        orderBy: { createdAt: "desc" },
      });

      let feedbackText: string | null = null;
      if (response) {
        const feedbackType = REASON_TO_FEEDBACK_TYPE[response.reason];
        if (feedbackType) {
          const feedbackMessage = await prisma.botInboundMessage.findFirst({
            where: {
              telegramId: u.telegramId,
              messageType: feedbackType,
              createdAt: { gte: response.createdAt },
            },
            orderBy: { createdAt: "asc" },
            select: { text: true },
          });
          feedbackText = feedbackMessage?.text ?? null;
        }
      }

      return {
        userId: u.id,
        telegramId: u.telegramId.toString(),
        username: u.username,
        firstName: u.firstName,
        lastName: u.lastName,
        sentAt: u.winbackCheckinSentAt!.toISOString(),
        optedOut: !!u.winbackOptedOutAt,
        response: response
          ? {
              id: response.id,
              reason: response.reason,
              createdAt: response.createdAt.toISOString(),
              feedbackText,
              isRead: response.isRead,
            }
          : null,
      };
    })
  );

  res.json(items);
};

// PATCH /admin/winback-responses/:id/read — отмечает ответ прочитанным,
// тот же смысл, что markChatAsRead у обычных обращений (chatController.ts).
export const markWinbackResponseAsRead = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  await prisma.winbackResponse.update({ where: { id }, data: { isRead: true } });
  res.json({ ok: true });
};

// Счётчик для бейджа вкладки/сайдбара — та же роль, что getUnreadMessages
// у обычных обращений, но UnreadContext дёргает этот эндпоинт отдельно
// (не через getUnreadMessages), потому что источник другой (WinbackResponse,
// не BotInboundMessage/AdminChatState).
export const getUnreadWinbackCount = async (_req: Request, res: Response): Promise<void> => {
  const count = await prisma.winbackResponse.count({ where: { isRead: false } });
  res.json({ count });
};
