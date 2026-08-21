import { Request, Response } from "express";
import { PaymentStatus } from "@prisma/client";
import { prisma } from "../prismaClient";
import { completePayment } from "../services/paymentCompletion";
import { fetchOpState, ROBOKASSA_STATE } from "../services/robokassaOpState";

// GET /admin/payments — список счетов. Тот же контракт постранички и поиска,
// что у /admin/users (limit/offset/search), чтобы страница вела себя как
// остальные списки в админке.
export const getPayments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { search, status, limit = "50", offset = "0" } = req.query as Record<string, string>;

    const take = Math.min(parseInt(limit, 10) || 50, 100);
    const skip = parseInt(offset, 10) || 0;

    const where: any = {};

    if (status === "PENDING" || status === "PAID") {
      where.status = status as PaymentStatus;
    }

    if (search && search.trim()) {
      const q = search.trim();
      const conditions: any[] = [
        { user: { firstName: { contains: q, mode: "insensitive" } } },
        { user: { lastName: { contains: q, mode: "insensitive" } } },
        { user: { username: { contains: q, mode: "insensitive" } } },
      ];
      // Номер счёта и telegramId — числовые; ищем по ним только если
      // запрос действительно число, иначе Prisma упадёт на приведении типа.
      const asNumber = parseInt(q, 10);
      if (!Number.isNaN(asNumber)) conditions.push({ invId: asNumber });
      try {
        conditions.push({ user: { telegramId: BigInt(q) } });
      } catch { /* не число — пропускаем */ }
      where.OR = conditions;
    }

    const [payments, total, paidTotal] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: { invId: "desc" },
        take,
        skip,
        include: {
          user: { select: { id: true, telegramId: true, firstName: true, lastName: true, username: true } },
        },
      }),
      prisma.payment.count({ where }),
      // Сумма оплаченного по текущему фильтру — чтобы не считать глазами.
      prisma.payment.aggregate({ where: { ...where, status: "PAID" }, _sum: { amount: true } }),
    ]);

    res.json({
      payments: payments.map((p) => ({
        id: p.id,
        invId: p.invId,
        amount: Number(p.amount),
        status: p.status,
        source: p.source,
        createdAt: p.createdAt.toISOString(),
        paidAt: p.paidAt?.toISOString() ?? null,
        receiptSentAt: p.receiptSentAt?.toISOString() ?? null,
        user: {
          id: p.user.id,
          telegramId: p.user.telegramId.toString(),
          firstName: p.user.firstName,
          lastName: p.user.lastName,
          username: p.user.username,
        },
      })),
      total,
      paidSum: Number(paidTotal._sum.amount ?? 0),
    });
  } catch (error) {
    console.error("[AdminPayments] Failed to list payments:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const STATE_LABELS: Record<number, string> = {
  [ROBOKASSA_STATE.NEW]: "Новый, деньги не получены",
  [ROBOKASSA_STATE.INITIATED]: "Инициализирован, деньги не получены",
  [ROBOKASSA_STATE.CANCELLED]: "Отменён, деньги не получены",
  [ROBOKASSA_STATE.PROCESSING]: "Деньги получены, идёт зачисление магазину",
  [ROBOKASSA_STATE.RETURNED]: "Деньги возвращены покупателю",
  [ROBOKASSA_STATE.SUSPENDED]: "Исполнение приостановлено",
  [ROBOKASSA_STATE.COMPLETED]: "Оплачен успешно",
};

/**
 * POST /admin/payments/:id/check — спросить Robokassa о реальном состоянии
 * счёта. Ручной аналог автоматической сверки (reconcilePayments.ts): нужен,
 * когда разбираешься с конкретным платежом и не хочешь ждать следующего
 * прогона крона.
 *
 * Если Robokassa говорит "деньги получены", а у нас PENDING — платёж
 * проводится здесь же, той же функцией, что и обычная оплата. То есть
 * кнопка не только показывает статус, но и чинит расхождение.
 */
export const checkPaymentStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!payment) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    const state = await fetchOpState(payment.invId);

    if (state.kind === "error") {
      res.json({
        ok: false,
        message: `Не удалось спросить Robokassa: ${state.message}`,
      });
      return;
    }

    if (state.kind === "not_found") {
      res.json({
        ok: true,
        stateCode: null,
        stateLabel: "Robokassa не знает такого счёта — пользователь не дошёл до страницы оплаты",
        changed: false,
        status: payment.status,
        // Зеркальное расхождение: у нас доступ выдан, а на стороне
        // Robokassa счёта нет вовсе. Само по себе не чинится (отнимать
        // выданный доступ по одному ответу API нельзя), но админ должен
        // об этом узнать, а не пройти мимо.
        message:
          payment.status === "PAID"
            ? "Внимание: у нас счёт отмечен оплаченным, а Robokassa его не знает. Разобраться вручную."
            : undefined,
      });
      return;
    }

    const stateLabel = STATE_LABELS[state.stateCode] ?? `Неизвестный код ${state.stateCode}`;
    const moneyReceived =
      state.stateCode === ROBOKASSA_STATE.PROCESSING || state.stateCode === ROBOKASSA_STATE.COMPLETED;

    // Расхождение в нашу пользу чиним сразу — ровно то, ради чего кнопка и
    // нужна. Обратное расхождение (у нас PAID, у них нет) не трогаем
    // автоматически: отнимать выданный доступ на основании одного ответа
    // API — не то решение, которое стоит принимать без человека.
    if (moneyReceived && payment.status === "PENDING") {
      const result = await completePayment(payment, Number(payment.amount));
      res.json({
        ok: true,
        stateCode: state.stateCode,
        stateLabel,
        changed: result.outcome === "granted",
        status: "PAID",
        message:
          result.outcome === "granted"
            ? "Деньги получены — доступ выдан, счёт отмечен оплаченным."
            : "Счёт уже был проведён параллельно.",
      });
      return;
    }

    res.json({
      ok: true,
      stateCode: state.stateCode,
      stateLabel,
      changed: false,
      status: payment.status,
      message:
        !moneyReceived && payment.status === "PAID"
          ? "Внимание: у нас счёт отмечен оплаченным, а Robokassa денег не подтверждает. Разобраться вручную."
          : undefined,
    });
  } catch (error) {
    console.error("[AdminPayments] Failed to check payment:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
