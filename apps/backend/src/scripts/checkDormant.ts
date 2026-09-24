/**
 * Чекин сегменту «Отвалившиеся» из «Реальной аудитории»
 * (adminDashboardController.ts::getUserActivitySegments) — последний
 * просмотр карточки описания (PatternView) 90+ дней назад, ЛЮБОЙ статус
 * подписки, включая пользователей, никогда не плативших. Отдельный от
 * checkWinback.ts скрипт: тот покрывает только платных подписчиков и
 * другой критерий неактивности (lastSeenAt, не заходил ~12 дней) — эта
 * рассылка шире по аудитории и грубее по порогу (90 дней без реального
 * просмотра каталога, не просто "не заходил"). Текст сообщения тоже
 * другой (sendDormantCheckin, не sendWinbackCheckin) — аудитория часто не
 * заходила почти с запуска проекта, "давно вас не было" тут не звучит,
 * вместо этого называем текущий объём каталога как конкретную причину
 * вернуться.
 *
 * "Никогда не смотрел ни одной карточки" (last_view IS NULL — сегмент
 * "dead" в getUserActivitySegments) сюда НЕ входит: это не отвал, а
 * человек, который никогда толком не пользовался каталогом — другой смысл
 * сообщения, другая рассылка, если вообще нужна.
 *
 * winbackOptedOutAt — тот же общий отказ, что и у checkWinback.ts (тот же
 * текст кнопки "Не спрашивать больше" в winbackNotifier.ts), уважается
 * здесь тоже: кто отказался от опроса вообще, не должен получать его в
 * другом обличье.
 *
 * Прогон с `--dry-run` ничего не меняет и не шлёт.
 */
import { UserRole } from "@prisma/client";
import { prisma } from "../prismaClient";
import { sendDormantCheckin } from "../services/winbackNotifier";

const INACTIVITY_DAYS_THRESHOLD = 90;

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const now = new Date();
  const inactivitySince = new Date(now.getTime() - INACTIVITY_DAYS_THRESHOLD * 24 * 60 * 60 * 1000);

  console.log(`[Dormant] Прогон ${now.toISOString()}${dryRun ? " (DRY RUN — ничего не меняем)" : ""}`);

  // last_view — тот же способ вычисления, что и "churned" в
  // getUserActivitySegments (MAX(PatternView.createdAt) на пользователя),
  // намеренно НЕ lastSeenAt — то поле проставляется и при пустом заходе
  // без единого действия в каталоге.
  const candidates = await prisma.$queryRaw<{ id: string; telegramId: bigint; lastView: Date }[]>`
    WITH stats AS (
      SELECT u.id, u."telegramId", v.last_view
      FROM "User" u
      LEFT JOIN (
        SELECT "userId", MAX("createdAt") AS last_view FROM "PatternView" GROUP BY "userId"
      ) v ON v."userId" = u.id
      WHERE u."excludeFromStats" = false
        AND u.role != ${UserRole.ADMIN}::"UserRole"
        AND u."winbackOptedOutAt" IS NULL
        AND (u."dormantCheckinSentAt" IS NULL OR u."dormantCheckinSentAt" < u."lastSeenAt")
    )
    SELECT id, "telegramId", last_view AS "lastView"
    FROM stats
    WHERE last_view IS NOT NULL AND last_view <= ${inactivitySince}
  `;

  console.log(`[Dormant] Кандидатов: ${candidates.length}`);

  // Одно число на весь прогон — не пересчитываем на каждого получателя,
  // все письма одной рассылки должны называть одну и ту же цифру.
  // isVisible: true — тот же фильтр, что у публичного каталога
  // (patternsController.ts), иначе цифра в письме была бы больше того, что
  // человек реально увидит, открыв приложение.
  const patternsCount = await prisma.pattern.count({ where: { isVisible: true } });

  let sent = 0;
  let permanentlyUnreachable = 0;

  for (const user of candidates) {
    if (dryRun) {
      console.log(`[Dormant]   (dry-run) чекин → ${user.telegramId}, последний просмотр ${user.lastView.toISOString()}`);
      continue;
    }
    const result = await sendDormantCheckin(user.telegramId, patternsCount);
    if (result.delivered) {
      await prisma.user.update({ where: { id: user.id }, data: { dormantCheckinSentAt: new Date() } });
      sent++;
    } else if (result.permanentlyUnreachable) {
      await prisma.user.update({
        where: { id: user.id },
        data: { winbackOptedOutAt: new Date(), winbackOptOutReason: "UNREACHABLE" },
      });
      permanentlyUnreachable++;
      console.error(`[Dormant]   чекин недоставим НАВСЕГДА → ${user.telegramId}, исключён из рассылки`);
    } else {
      console.error(`[Dormant]   чекин НЕ доставлен → ${user.telegramId}, повторим завтра`);
    }
  }

  console.log(
    `[Dormant] Итог: отправлено ${sent}/${candidates.length}, недостижимо навсегда ${permanentlyUnreachable}` +
      `${dryRun ? " (dry-run, изменений нет)" : ""}`
  );
}

main()
  .catch((err) => {
    console.error("[Dormant] Прогон упал:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
