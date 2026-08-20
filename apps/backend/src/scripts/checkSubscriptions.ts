/**
 * Ежедневный джоб по платным подпискам (PAYMENTS_ROBOKASSA_PLAN.md §6,
 * §7 шаг 7). Два действия за один прогон:
 *   1. Напоминание за 3 дня до истечения — пока доступ ещё работает.
 *   2. Отключение по истечении: снятие PREMIUM_CORE + PREMIUM_EXTRA и
 *      уведомление о самом факте (решение по §8.2 — шлём оба сообщения).
 *
 * Запускается обёрткой run_subscription_check.sh из cron, раз в сутки —
 * из суточной частоты и получается тот самый grace period до суток (§6),
 * отдельно он нигде не кодируется.
 *
 * ВАЖНО про безопасность массовой операции: снятие разрешений
 * ограничено `premiumExpiresAt < now()`, а у всех бесплатных
 * пользователей это поле NULL (временный бэкофилл PREMIUM_CORE, см.
 * PAID_TIER_PERMISSIONS_PLAN.md §8). В SQL `NULL < now()` даёт NULL, а не
 * true, поэтому бесплатные под выборку не попадают в принципе — джоб
 * физически не может массово отобрать доступ у тех 3900, кому его выдали
 * бэкофиллом. Админы исключены отдельно: у них доступ идёт от role, и
 * трогать их явные разрешения незачем.
 *
 * Прогон с `--dry-run` ничего не меняет и не шлёт — только печатает, что
 * сделал бы. Первый прогон на проде имеет смысл делать именно так.
 */
import { Permission, UserRole } from "@prisma/client";
import { prisma } from "../prismaClient";
import { sendExpiryReminder, sendExpiredNotice } from "../services/subscriptionNotifier";

const REMINDER_DAYS_BEFORE = 3;

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const now = new Date();
  const reminderThreshold = new Date(now.getTime() + REMINDER_DAYS_BEFORE * 24 * 60 * 60 * 1000);

  console.log(`[Subscriptions] Прогон ${now.toISOString()}${dryRun ? " (DRY RUN — ничего не меняем)" : ""}`);

  // ── 1. Напоминания ────────────────────────────────────────────────────
  // premiumReminderSentAt=null — чтобы за один оплаченный период напомнить
  // ровно один раз, а не все три дня подряд (окно совпадает при каждом
  // суточном прогоне).
  const toRemind = await prisma.user.findMany({
    where: {
      premiumExpiresAt: { gt: now, lte: reminderThreshold },
      premiumReminderSentAt: null,
      role: { not: UserRole.ADMIN },
    },
    select: { id: true, telegramId: true, premiumExpiresAt: true },
  });

  console.log(`[Subscriptions] К напоминанию: ${toRemind.length}`);
  let remindersSent = 0;

  for (const user of toRemind) {
    if (dryRun) {
      console.log(`[Subscriptions]   (dry-run) напоминание → ${user.telegramId}, истекает ${user.premiumExpiresAt?.toISOString()}`);
      continue;
    }
    const delivered = await sendExpiryReminder(user.telegramId, user.premiumExpiresAt!);
    if (delivered) {
      // Метка ставится только при подтверждённой доставке — иначе на
      // следующем прогоне попробуем ещё раз, а не молча пропустим.
      await prisma.user.update({ where: { id: user.id }, data: { premiumReminderSentAt: new Date() } });
      remindersSent++;
    } else {
      console.error(`[Subscriptions]   напоминание НЕ доставлено → ${user.telegramId}, повторим завтра`);
    }
  }

  // ── 2. Отключение по истечении ────────────────────────────────────────
  // Условие "ещё есть что снимать" держит выборку идемпотентной: после
  // снятия разрешений пользователь под неё больше не попадёт, и повторное
  // уведомление об отключении не уйдёт.
  const toRevoke = await prisma.user.findMany({
    where: {
      premiumExpiresAt: { lt: now },
      role: { not: UserRole.ADMIN },
      permissions: { some: { permission: { in: [Permission.PREMIUM_CORE, Permission.PREMIUM_EXTRA] } } },
    },
    select: { id: true, telegramId: true, premiumExpiresAt: true },
  });

  console.log(`[Subscriptions] К отключению: ${toRevoke.length}`);
  let revoked = 0;

  for (const user of toRevoke) {
    if (dryRun) {
      console.log(`[Subscriptions]   (dry-run) отключение → ${user.telegramId}, истекла ${user.premiumExpiresAt?.toISOString()}`);
      continue;
    }
    await prisma.userPermission.deleteMany({
      where: {
        userId: user.id,
        permission: { in: [Permission.PREMIUM_CORE, Permission.PREMIUM_EXTRA] },
      },
    });
    revoked++;
    // Доступ уже снят — доставка уведомления на это не влияет, поэтому
    // результат только логируем (в отличие от напоминания, где метка
    // зависит от факта отправки).
    const delivered = await sendExpiredNotice(user.telegramId);
    if (!delivered) {
      console.error(`[Subscriptions]   уведомление об отключении НЕ доставлено → ${user.telegramId} (доступ всё равно снят)`);
    }
  }

  console.log(
    `[Subscriptions] Итог: напоминаний отправлено ${remindersSent}/${toRemind.length}, ` +
      `отключено ${revoked}/${toRevoke.length}${dryRun ? " (dry-run, изменений нет)" : ""}`
  );
}

main()
  .catch((err) => {
    console.error("[Subscriptions] Прогон упал:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
