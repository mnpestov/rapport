import { Payment, Permission, User } from "@prisma/client";
import { prisma } from "../prismaClient";
import { sendPaymentReceipt } from "./paymentReceiptSender";

export const SUBSCRIPTION_PERIOD_DAYS = 30;

export type CompletionResult =
  | { outcome: "granted"; newExpiresAt: Date }
  // Платёж уже был проведён — либо параллельным запросом, либо повторной
  // доставкой от Robokassa, либо сверкой (reconcilePayments.ts), пока
  // webhook шёл. Не ошибка: вызывающий отвечает "всё ок", но ничего не
  // делает повторно.
  | { outcome: "already_paid" };

/**
 * ЕДИНСТВЕННОЕ место, где выдаётся платный доступ. Вызывается из двух
 * путей — обработчика Result URL (paymentsController) и сверки с Robokassa
 * (scripts/reconcilePayments.ts). Вынесено в общую функцию намеренно: пока
 * логика жила внутри webhook, у сверки не было способа провести платёж
 * ровно так же, а две копии со временем разошлись бы — и пользователь,
 * которого спасла сверка, получил бы доступ не такой, как обычный
 * плательщик.
 *
 * Гонка (два платежа одного пользователя почти одновременно) закрыта в два
 * слоя внутри одной интерактивной транзакции:
 *  1. updateMany с WHERE status='PENDING' — атомарный conditional update;
 *     count === 0 означает, что строку уже забрал кто-то другой.
 *  2. SELECT ... FOR UPDATE на строке User — сериализует расчёт нового
 *     premiumExpiresAt, иначе оба запроса прочитали бы одно старое
 *     значение и второй платёж потерялся бы (lost update).
 */
export async function completePayment(
  payment: Payment & { user: User },
  paidAmount: number
): Promise<CompletionResult> {
  const now = new Date();
  const user = payment.user;
  let newExpiresAt: Date | null = null;

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status: "PAID", paidAt: now },
    });
    if (claimed.count === 0) return;

    const locked = await tx.$queryRaw<{ premiumExpiresAt: Date | null }[]>`
      SELECT "premiumExpiresAt" FROM "User" WHERE id = ${user.id} FOR UPDATE
    `;
    const lockedExpiresAt = locked[0]?.premiumExpiresAt ?? null;
    // Продление "с запасом" (§8.1): если период ещё не истёк, новые 30 дней
    // добавляются поверх него, а не поверх now() — досрочная оплата не
    // отнимает уже оплаченные дни.
    const basis = lockedExpiresAt && lockedExpiresAt > now ? lockedExpiresAt : now;
    newExpiresAt = new Date(basis.getTime() + SUBSCRIPTION_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    await tx.user.update({
      where: { id: user.id },
      data: {
        premiumExpiresAt: newExpiresAt,
        // Новый оплаченный период — снова имеет право на своё напоминание
        // за 3 дня (см. checkSubscriptions.ts).
        premiumReminderSentAt: null,
      },
    });
    await tx.userPermission.upsert({
      where: { userId_permission: { userId: user.id, permission: Permission.PREMIUM_CORE } },
      create: { userId: user.id, permission: Permission.PREMIUM_CORE },
      update: {},
    });
    await tx.userPermission.upsert({
      where: { userId_permission: { userId: user.id, permission: Permission.PREMIUM_EXTRA } },
      create: { userId: user.id, permission: Permission.PREMIUM_EXTRA },
      update: {},
    });
  });

  if (!newExpiresAt) return { outcome: "already_paid" };

  // Доставка чека не блокирует выдачу доступа и не должна ронять ответ,
  // которого ждёт Robokassa, — отсюда fire-and-forget. receiptSentAt
  // проставляется только при подтверждённой доставке, иначе поле врало бы
  // о том, что пользователь получил уведомление.
  const grantedExpiresAt: Date = newExpiresAt;
  sendPaymentReceipt(user.telegramId, paidAmount, grantedExpiresAt)
    .then((delivered) => {
      if (delivered) {
        return prisma.payment.update({
          where: { id: payment.id },
          data: { receiptSentAt: new Date() },
        });
      }
      console.error(`[Payments] Receipt not delivered for InvId=${payment.invId} — receiptSentAt left null.`);
    })
    .catch((err) => console.error(`[Payments] Failed to send receipt for InvId=${payment.invId}:`, err));

  return { outcome: "granted", newExpiresAt: grantedExpiresAt };
}
