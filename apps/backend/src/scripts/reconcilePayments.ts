/**
 * Сверка зависших платежей с Robokassa (PAYMENTS_ROBOKASSA_PLAN.md §10.4).
 *
 * Зачем: зависший PENDING неотличим от нормального отказа. И "человек ушёл
 * со страницы оплаты" (частый случай), и "деньги взяли, а Result URL до нас
 * не дошёл" (редкий, критичный) выглядят в нашей базе одинаково. По своим
 * данным различить невозможно — но можно спросить Robokassa через OpState.
 *
 * Джоб проходит по PENDING старше MIN_AGE_MINUTES и по коду состояния либо
 * проводит платёж той же функцией, что и webhook (completePayment), либо
 * оставляет как есть. Ничего не удаляет: брошенные PENDING — не мусор, а
 * данные для воронки (§10.3).
 *
 * Запускается обёрткой run_payment_reconcile.sh из cron каждые 15 минут —
 * чаще, чем суточная проверка подписок: человек, чей платёж потерялся, не
 * должен ждать доступ до утра.
 *
 * --dry-run ничего не меняет и не шлёт, только печатает.
 */
import { prisma } from "../prismaClient";
import { completePayment } from "../services/paymentCompletion";
import { sendPaymentAlert } from "../services/paymentAlerts";
import { fetchOpState, ROBOKASSA_STATE } from "../services/robokassaOpState";

// Нормальный флоу оплаты укладывается в несколько минут. 30 — с запасом,
// чтобы не дёргать Robokassa по платежам, которые прямо сейчас в процессе.
const MIN_AGE_MINUTES = 30;
// Дальше этого срока смысла спрашивать нет: Robokassa отдаёт счёт как
// ненайденный, а живых платежей такой давности не бывает.
const MAX_AGE_DAYS = 14;

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const now = Date.now();
  const notAfter = new Date(now - MIN_AGE_MINUTES * 60 * 1000);
  const notBefore = new Date(now - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

  console.log(`[Reconcile] Прогон ${new Date().toISOString()}${dryRun ? " (DRY RUN — ничего не меняем)" : ""}`);

  const stale = await prisma.payment.findMany({
    where: { status: "PENDING", createdAt: { lt: notAfter, gt: notBefore } },
    include: { user: true },
    orderBy: { invId: "asc" },
  });

  console.log(`[Reconcile] Зависших PENDING к проверке: ${stale.length}`);

  let recovered = 0;
  let abandoned = 0;
  let needsAttention = 0;
  let errors = 0;

  for (const payment of stale) {
    const state = await fetchOpState(payment.invId);

    if (state.kind === "error") {
      // Сбой связи — НЕ повод считать платёж брошенным: при недоступности
      // Robokassa мы бы так закрывали живые оплаты. Просто пропускаем до
      // следующего прогона.
      console.error(`[Reconcile] InvId=${payment.invId}: не удалось спросить — ${state.message}`);
      errors++;
      continue;
    }

    if (state.kind === "not_found") {
      // Счёт не создавался на стороне Robokassa — пользователь нажал
      // "Оформить", но до страницы оплаты не дошёл.
      abandoned++;
      continue;
    }

    switch (state.stateCode) {
      case ROBOKASSA_STATE.PROCESSING:
      case ROBOKASSA_STATE.COMPLETED: {
        // Деньги реально получены, а доступа у человека нет — ровно тот
        // случай, ради которого всё это.
        console.log(`[Reconcile] InvId=${payment.invId}: деньги получены (код ${state.stateCode}), выдаём доступ`);
        if (dryRun) { recovered++; break; }

        const result = await completePayment(payment, Number(payment.amount));
        if (result.outcome === "granted") {
          recovered++;
          await sendPaymentAlert(
            `reconciled-${payment.invId}`,
            `Платёж InvId=${payment.invId} на ${payment.amount} ₽ прошёл у Robokassa, ` +
              `но уведомление до нас не дошло. Сверка нашла и выдала доступ до ` +
              `${result.newExpiresAt.toLocaleDateString("ru-RU")}.\n\n` +
              `Пользователь не пострадал, но стоит проверить, почему не сработал Result URL.`
          );
        }
        break;
      }

      case ROBOKASSA_STATE.RETURNED:
        // Деньги вернули покупателю. Доступ не выдаём; если он уже был
        // выдан webhook-ом до возврата — статус платежа PAID, и сюда такой
        // платёж не попадёт, поэтому здесь только уведомляем.
        console.log(`[Reconcile] InvId=${payment.invId}: возврат средств (код 60)`);
        needsAttention++;
        if (!dryRun) {
          await sendPaymentAlert(
            `returned-${payment.invId}`,
            `По платежу InvId=${payment.invId} деньги были возвращены покупателю. Доступ не выдан.`
          );
        }
        break;

      case ROBOKASSA_STATE.SUSPENDED:
        console.log(`[Reconcile] InvId=${payment.invId}: исполнение приостановлено (код 80)`);
        needsAttention++;
        if (!dryRun) {
          await sendPaymentAlert(
            `suspended-${payment.invId}`,
            `Платёж InvId=${payment.invId} приостановлен на стороне Robokassa (код 80). Нужен ручной разбор.`
          );
        }
        break;

      default:
        // 0/5/10 — денег не было, штатный отказ.
        abandoned++;
    }
  }

  // Системная поломка: платежи создаются, но ни один не доходит. Так
  // выглядят упавший прокси /payments и разъехавшиеся пароли.
  if (!dryRun && stale.length >= 5 && recovered === 0 && abandoned === stale.length) {
    const paidRecently = await prisma.payment.count({
      where: { status: "PAID", paidAt: { gt: new Date(now - 24 * 60 * 60 * 1000) } },
    });
    if (paidRecently === 0) {
      await sendPaymentAlert(
        "no-successful-payments",
        `За сутки ни одной успешной оплаты, при этом ${stale.length} платежей зависли в PENDING.\n\n` +
          `Похоже на системную поломку: проверьте проксирование /payments в nginx и пароли Robokassa в .env.`
      );
    }
  }

  console.log(
    `[Reconcile] Итог: восстановлено ${recovered}, брошено ${abandoned}, ` +
      `требует внимания ${needsAttention}, ошибок связи ${errors}${dryRun ? " (dry-run)" : ""}`
  );
}

main()
  .catch((err) => {
    console.error("[Reconcile] Прогон упал:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
