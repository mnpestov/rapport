import cron from "node-cron";
import { prisma } from "../prismaClient";

// ── Пересчёт popularityScore ────────────────────────────────────────────────
//
// Почему не «сколько раз добавили в избранное»: этот счётчик измеряет показы,
// а не интерес. На проде бесплатные описания — 2.9% каталога, но открытий
// карточки у них 42.7 против 6.4 у платных (в 6.7 раза больше), и избранного
// ровно во столько же раз больше — 17.4 против 2.7. В топ-10 по сырому
// избранному попадали 10 бесплатных из 10. При этом на РАВНОМ числе открытий
// разница почти исчезает: доля вовлечённых 0.56 против 0.54 на 11–30
// просмотрах и 0.60 против 0.56 на 30+. То есть весь отрыв — экспозиция.
//
// Поэтому считаем долю открывших, которые сделали что-то значимое, а не
// абсолютные числа. Тот же перекос есть и у самих просмотров, и у переходов
// к автору (17 из 30 в топе — бесплатные), так что заменой одного счётчика на
// другой он не лечится.
//
// Карточное избранное (сердечко в каталоге, без открытия описания) в счёт НЕ
// идёт, хотя это 65% всех добавлений: его не на что нормировать — показы
// карточек не логируются. Проверено: если вернуть его в формулу, доля
// бесплатных в топ-30 подскакивает с 9 обратно до 17.

// Окно наблюдения. Всё, что старше, в расчёт не идёт.
//
// 2026-09: сокращено 60 → 30 дней. На 60-дневном окне топ «застыл»: топ-200
// целиком был не старше 90 дней (весь каталог такой), но медианный возраст
// топ-30 — 63 дня, а из свежих (published ≤ 30 дней) в топ-30 попадали
// только 3. Событий хватает: медиана открытий на описание за 30 дней — те
// же ~5, что и за 60 (свежие описания собирают трафик быстро). На
// офлайн-прогоне по проду сокращение окна опустило медианный возраст
// топ-30 до ~43 дней и подняло долю свежих в топ-30 с 3 до 7, не задев
// долю бесплатных (см. ниже).
const WINDOW_DAYS = 30;

// Сила сглаживания по объёму. Ручка компромисса «качество ↔ объём»: на живых
// данных m=10 даёт в топ-30 шесть бесплатных, но пускает описания с восемью
// открытиями; m=100 — четырнадцать бесплатных и минимум 18 открытий.
//
// 2026-09: 25 → 20 вместе с сокращением окна. На 30-дневном окне у описаний
// меньше накопленных открытий, и m=25 слишком тянул всё к априору автора,
// сохраняя инерцию верхушки. m=20 на офлайн-прогоне даёт девять... нет,
// восемь бесплатных из топ-30 при минимуме 13 открытий в топ-10 — тот же
// баланс «популярное, а не бесплатное», что был на 60/25.
const SMOOTHING = 20;

// Сглаживание априора автора к глобальному. Разброс качества по авторам
// реальный (у 94 авторов со 100+ открытиями доля переходов от 0.23 до 0.63
// при среднем 0.41), но у автора с двумя описаниями своя доля — шум.
//
// 2026-09: 50 → 35. На меньшем окне сильный априор автора — главный источник
// «одни и те же авторы в топе»: новинка известного автора стартовала почти
// с его средней. 35 ослабляет это, не выпуская в топ описания с 3–4
// открытиями на одном авторе (их держит MIN_VIEWS_FOR_TOP).
const AUTHOR_SMOOTHING = 35;

// Ниже этого числа открытий описание не может обойти среднее по каталогу.
// Само сглаживание почти справляется, но у сильного автора высокий априор:
// без этой отсечки описание с четырьмя открытиями и четырьмя действиями
// получило бы 0.68 и въехало в первую двадцатку на одном авторе.
//
// 2026-09: 5 → 3. Медиана открытий за 30 дней — 5, у ~46% каталога меньше
// пяти: порог в 5 полностью запирал почти половину описаний ниже среднего.
// 3 даёт свежим описаниям шанс, а «4 открытия на одном авторе» всё ещё
// отсекает априор + сглаживание.
const MIN_VIEWS_FOR_TOP = 3;

interface PatternStats {
  patternId: string;
  authorId: string;
  views: number;
  engaged: number;
}

// Одним запросом вместо трёх агрегатов через Prisma: нужно СЧИТАТЬ
// УНИКАЛЬНЫХ пользователей и, главное, засчитывать добавление в избранное
// только если тот же человек описание открывал — а это уже пересечение трёх
// таблиц, которое ORM выразит хуже, чем сам SQL.
const STATS_SQL = `
  WITH v AS (
    SELECT "patternId", "userId"
    FROM "PatternView"
    WHERE "createdAt" >= $1
    GROUP BY "patternId", "userId"
  ),
  engaged AS (
    SELECT "patternId", "userId"
    FROM "PatternLinkClick"
    WHERE "createdAt" >= $1
    GROUP BY "patternId", "userId"
    UNION
    -- Избранное засчитывается только вместе с открытием: сердечко с карточки
    -- каталога знаменателя не имеет (см. комментарий выше).
    SELECT f."patternId", f."userId"
    FROM "UserFavorite" f
    JOIN v ON v."patternId" = f."patternId" AND v."userId" = f."userId"
    WHERE f."createdAt" >= $1
  )
  SELECT p.id                                        AS "patternId",
         p."authorId"                                AS "authorId",
         COUNT(DISTINCT v."userId")::int             AS views,
         COUNT(DISTINCT engaged."userId")::int       AS engaged
  FROM "Pattern" p
  LEFT JOIN v ON v."patternId" = p.id
  LEFT JOIN engaged ON engaged."patternId" = p.id
  WHERE p."isVisible"
  GROUP BY p.id, p."authorId"
`;

export async function recomputePopularity(): Promise<void> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRawUnsafe<PatternStats[]>(STATS_SQL, since);

  const totalViews = rows.reduce((sum, r) => sum + r.views, 0);
  const totalEngaged = rows.reduce((sum, r) => sum + r.engaged, 0);
  // Если событий в окне нет вообще (пустая база, первый запуск на свежем
  // окружении) — делить не на что; 0.5 просто означает «ничего не знаем».
  const globalRate = totalViews > 0 ? totalEngaged / totalViews : 0.5;

  // Априор автора — чтобы новинки сильного автора стартовали не с середины.
  // На проде 389 описаний вообще без открытий и ещё ~900 с одним-двумя: без
  // этого они все получили бы один и тот же балл.
  const byAuthor = new Map<string, { views: number; engaged: number }>();
  for (const r of rows) {
    const acc = byAuthor.get(r.authorId) ?? { views: 0, engaged: 0 };
    acc.views += r.views;
    acc.engaged += r.engaged;
    byAuthor.set(r.authorId, acc);
  }

  const authorPrior = (authorId: string): number => {
    const a = byAuthor.get(authorId);
    if (!a) return globalRate;
    return (a.engaged + AUTHOR_SMOOTHING * globalRate) / (a.views + AUTHOR_SMOOTHING);
  };

  const scored = rows.map((r) => {
    const prior = authorPrior(r.authorId);
    const score = (r.engaged + SMOOTHING * prior) / (r.views + SMOOTHING);
    return {
      id: r.patternId,
      score: r.views < MIN_VIEWS_FOR_TOP ? Math.min(score, globalRate) : score,
    };
  });

  // Пишем одним UPDATE ... FROM (VALUES ...) вместо трёх тысяч отдельных
  // update: по строке на описание это три тысячи round-trip'ов, здесь —
  // один. Батчами, чтобы не упереться в лимит параметров Postgres (65535).
  const BATCH = 1000;
  let updated = 0;
  for (let i = 0; i < scored.length; i += BATCH) {
    const batch = scored.slice(i, i + BATCH);
    // id — text, а не uuid: Pattern.id объявлен как String @default(uuid()),
    // Postgres хранит его текстом, и каст в ::uuid ронял бы UPDATE на
    // `operator does not exist: text = uuid`.
    const values = batch.map((_, j) => `($${j * 2 + 1}::text, $${j * 2 + 2}::double precision)`).join(",");
    const params = batch.flatMap((s) => [s.id, s.score]);
    updated += await prisma.$executeRawUnsafe(
      `UPDATE "Pattern" p SET "popularityScore" = x.score
       FROM (VALUES ${values}) AS x(id, score)
       WHERE p.id = x.id AND p."popularityScore" IS DISTINCT FROM x.score`,
      ...params
    );
  }

  console.log(
    `[popularity] пересчитано ${scored.length} описаний, изменилось ${updated}; ` +
      `окно ${WINDOW_DAYS}д, средняя вовлечённость ${globalRate.toFixed(3)}`
  );
}

// Единственный инстанс rapport-api (pm2 без cluster mode) — планировать
// в процессе безопасно, распределённая блокировка не нужна. Тот же довод,
// что и у expireNewPatterns.
export function startPopularityJob(): void {
  recomputePopularity().catch((err) => console.error("[popularity] initial run failed:", err));

  // В 3:30 — после expireNewPatterns (3:00), чтобы два ночных прохода по
  // Pattern не шли одновременно.
  cron.schedule("30 3 * * *", () => {
    recomputePopularity().catch((err) => console.error("[popularity] scheduled run failed:", err));
  });
}
