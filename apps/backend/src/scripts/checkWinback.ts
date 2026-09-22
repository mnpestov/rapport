/**
 * Ежедневный джоб winback-опроса (план в чате, сентябрь 2026): мягкий
 * чекин платным подписчикам, не заходившим INACTIVITY_DAYS_THRESHOLD дней,
 * независимо от срока подписки — окно риска шире, чем последние 3 дня
 * перед истечением (checkSubscriptions.ts), и человек может не увидеть
 * баннер продления вовсе, если давно не открывал приложение.
 *
 * Не пересекается с checkSubscriptions.ts: та шлёт предупреждение об
 * истечении подписки (тема — деньги/доступ), это — мягкий чекин
 * "давно вас не было" (тема — вовлечённость), разные сообщения, разные
 * получатели чаще всего (подписка может быть и далеко от истечения).
 *
 * Тот же паттерн кулдауна, что у premiumReminderSentAt, но с ДРУГИМ
 * условием сброса: там сброс — конкретное событие (новая оплата), здесь —
 * "пользователь заходил после последней отправки" (winbackCheckinSentAt <
 * lastSeenAt). Один и тот же человек может молчать несколько раз за время
 * подписки, и каждый новый период неактивности заслуживает свой чекин.
 *
 * winbackOptedOutAt — постоянный, не протухает: кто попросил не спрашивать,
 * исключается навсегда, а не до следующего визита.
 *
 * Прогон с `--dry-run` ничего не меняет и не шлёт.
 */
import { UserRole } from "@prisma/client";
import { prisma } from "../prismaClient";
import { sendWinbackCheckin } from "../services/winbackNotifier";

const INACTIVITY_DAYS_THRESHOLD = 12;

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const now = new Date();
  const inactivitySince = new Date(now.getTime() - INACTIVITY_DAYS_THRESHOLD * 24 * 60 * 60 * 1000);

  console.log(`[Winback] Прогон ${now.toISOString()}${dryRun ? " (DRY RUN — ничего не меняем)" : ""}`);

  // "winbackCheckinSentAt < lastSeenAt" сравнивает две колонки одной
  // строки — Prisma это не выражает через обычный where (нет column-to-
  // column сравнения в query API), поэтому здесь $queryRaw. Остальные
  // условия остаются в SQL же, чтобы не тащить в Node весь User целиком.
  const candidates = await prisma.$queryRaw<{ id: string; telegramId: bigint; lastSeenAt: Date | null }[]>`
    SELECT id, "telegramId", "lastSeenAt"
    FROM "User"
    WHERE "excludeFromStats" = false
      AND role != ${UserRole.ADMIN}::"UserRole"
      AND "premiumExpiresAt" > ${now}
      AND "lastSeenAt" <= ${inactivitySince}
      AND "winbackOptedOutAt" IS NULL
      AND ("winbackCheckinSentAt" IS NULL OR "winbackCheckinSentAt" < "lastSeenAt")
  `;

  console.log(`[Winback] Кандидатов: ${candidates.length}`);
  let sent = 0;

  for (const user of candidates) {
    if (dryRun) {
      console.log(`[Winback]   (dry-run) чекин → ${user.telegramId}, не заходил с ${user.lastSeenAt?.toISOString()}`);
      continue;
    }
    const delivered = await sendWinbackCheckin(user.telegramId);
    if (delivered) {
      // Метка только при подтверждённой доставке — как в checkSubscriptions.ts,
      // иначе недоставленное сообщение молча пометится как отправленное.
      await prisma.user.update({ where: { id: user.id }, data: { winbackCheckinSentAt: new Date() } });
      sent++;
    } else {
      console.error(`[Winback]   чекин НЕ доставлен → ${user.telegramId}, повторим завтра`);
    }
  }

  console.log(`[Winback] Итог: отправлено ${sent}/${candidates.length}${dryRun ? " (dry-run, изменений нет)" : ""}`);
}

main()
  .catch((err) => {
    console.error("[Winback] Прогон упал:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
