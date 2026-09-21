/**
 * Разовый бэкофилл: PREMIUM_YARNS раньше не выдавался автоматически при
 * оплате (добавлено в completePayment() только сейчас, 2026-09) — этот
 * скрипт выдаёт его всем, у кого подписка активна на момент запуска
 * (premiumExpiresAt > now), чтобы они не ждали следующей оплаты ради
 * фичи, за которую уже платят. Запускать один раз после деплоя изменения
 * в paymentCompletion.ts; повторные запуски безопасны (upsert).
 *
 * Прогон с `--dry-run` ничего не меняет — только печатает, кому бы выдал.
 */
import { Permission, UserRole } from "@prisma/client";
import { prisma } from "../prismaClient";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const now = new Date();

  const activeSubscribers = await prisma.user.findMany({
    where: {
      premiumExpiresAt: { gt: now },
      role: { not: UserRole.ADMIN },
      permissions: { none: { permission: Permission.PREMIUM_YARNS } },
    },
    select: { id: true, telegramId: true },
  });

  console.log(
    `[BackfillPremiumYarns] Прогон ${now.toISOString()}${dryRun ? " (DRY RUN — ничего не меняем)" : ""}`
  );
  console.log(`[BackfillPremiumYarns] К выдаче: ${activeSubscribers.length}`);

  if (dryRun) {
    for (const user of activeSubscribers) {
      console.log(`[BackfillPremiumYarns]   (dry-run) выдача → ${user.telegramId}`);
    }
    return;
  }

  for (const user of activeSubscribers) {
    await prisma.userPermission.upsert({
      where: { userId_permission: { userId: user.id, permission: Permission.PREMIUM_YARNS } },
      create: { userId: user.id, permission: Permission.PREMIUM_YARNS },
      update: {},
    });
  }

  console.log(`[BackfillPremiumYarns] Готово: выдано ${activeSubscribers.length}`);
}

main()
  .catch((err) => {
    console.error("[BackfillPremiumYarns] Прогон упал:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
