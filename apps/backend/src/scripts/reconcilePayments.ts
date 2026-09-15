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
// Окно "свежих" платежей для алерта о системной поломке — НЕ то же самое,
// что окно сверки выше. Сверяем с Robokassa всё до 14 дней (это нужно само
// по себе — вдруг деньги реально пришли), но алармить на "сутки нет ни
// одной оплаты" по ВСЕМ этим 14 дням нельзя: одна и та же пачка старых
// заброшенных платежей тогда торчит в выборке днями подряд, и при обычном
// затишье (никто вообще не пытался платить) алерт держится, пока не
// истечёт 14-дневное окно — то есть постоянно, просто теперь не чаще раза
// в 15 минут вместо каждого прогона. Публика 2026-09-15: после починки
// мьюта бот продолжал слать раз в 15 минут часами именно поэтому.
//
// Алерт должен реагировать на СИСТЕМНУЮ поломку — т.е. на то, что НОВЫЕ
// попытки оплаты создаются и все проваливаются прямо сейчас, а не на факт,
// что старые зависшие платежи существуют. Поэтому считаем отдельно: только
// платежи младше RECENT_WINDOW_HOURS.
const RECENT_WINDOW_HOURS = 3;

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

  // Для алерта "системная поломка" ниже — считаем ТОЛЬКО платежи младше
  // RECENT_WINDOW_HOURS (см. комментарий у константы). Старые заброшенные
  // платежи из 14-дневного окна сверки в этот счётчик не идут: иначе один
  // и тот же "хвост" держал бы алерт активным днями при обычном затишье.
  const recentCutoff = now - RECENT_WINDOW_HOURS * 60 * 60 * 1000;
  let recentStale = 0;
  let recentAbandoned = 0;
  let recentRecovered = 0;

  for (const payment of stale) {
    const isRecent = payment.createdAt.getTime() > recentCutoff;
    if (isRecent) recentStale++;

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
      if (isRecent) recentAbandoned++;
      continue;
    }

    switch (state.stateCode) {
      case ROBOKASSA_STATE.PROCESSING:
      case ROBOKASSA_STATE.COMPLETED: {
        // Деньги реально получены, а доступа у человека нет — ровно тот
        // случай, ради которого всё это.
        console.log(`[Reconcile] InvId=${payment.invId}: деньги получены (код ${state.stateCode}), выдаём доступ`);
        if (dryRun) { recovered++; if (isRecent) recentRecovered++; break; }

        const result = await completePayment(payment, Number(payment.amount));
        if (result.outcome === "granted") {
          recovered++;
          if (isRecent) recentRecovered++;
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
        if (isRecent) recentAbandoned++;
    }
  }

  // Системная поломка: НОВЫЕ платежи создаются прямо сейчас и ВСЕ
  // проваливаются — так выглядят упавший прокси /payments и разъехавшиеся
  // пароли. Считается только по свежим (< RECENT_WINDOW_HOURS) платежам:
  // если за это время никто вообще не пытался платить, recentStale = 0, и
  // алерт молчит — затишье не повод для тревоги, повод только полный
  // провал СВЕЖИХ попыток.
  if (!dryRun && recentStale >= 5 && recentRecovered === 0 && recentAbandoned === recentStale) {
    await sendPaymentAlert(
      "no-successful-payments",
      `За последние ${RECENT_WINDOW_HOURS}ч ${recentStale} новых платежей — и ни один не прошёл.\n\n` +
        `Похоже на системную поломку: проверьте проксирование /payments в nginx и пароли Robokassa в .env.`
    );
  }

  console.log(
    `[Reconcile] Итог: восстановлено ${recovered}, брошено ${abandoned}, ` +
      `требует внимания ${needsAttention}, ошибок связи ${errors}${dryRun ? " (dry-run)" : ""}; ` +
      `свежих (<${RECENT_WINDOW_HOURS}ч) — всего ${recentStale}, восстановлено ${recentRecovered}, брошено ${recentAbandoned}`
  );
}

main()
  .catch((err) => {
    console.error("[Reconcile] Прогон упал:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
