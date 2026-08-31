import { Request, Response, NextFunction } from "express";
import { prisma } from "../prismaClient";
import { checkTelegramSubscriptionDetailed } from "../utils/checkSubscription";
import { checkWhitelistAccess } from "../services/whitelistService";

/**
 * Серверная проверка подписки на канал для БРАУЗЕРНЫХ сессий
 * (BROWSER_ACCESS_PLAN.md §3.3, §4.4).
 *
 * Зачем: до этого подписка проверялась ровно один раз — при входе, и дальше
 * весь энфорсмент держался на добросовестности фронта (он сам рисовал экран
 * «нужна подписка»). Для Mini App это терпимо: initData живёт 24 часа, и
 * приложение переавторизуется при каждом открытии. Для браузера с
 * 30-дневным refresh-токеном отписавшийся сохранял бы доступ месяц —
 * достаточно было просто не дёргать клиентскую перепроверку.
 *
 * Кого пропускаем без проверки:
 *   - гостя без токена — анонимный каталог остаётся открытым, как и для
 *     неавторизованных в Mini App. Гейт стоит на выдаче сессии и на
 *     premium-полях, а не на самом существовании каталога;
 *   - Mini App (в токене нет sessionId) — там свой цикл проверки.
 *
 * Куда НЕ вешается (важно): /analytics (write-only + report-error:
 * отписавшийся должен мочь отправить баг), /channel (данные для экрана
 * «подпишись»), /payments (иначе локаут «не могу оплатить, потому что не
 * оплачено»), /auth/*.
 */

// Сколько живёт закэшированный результат проверки подписки на сессии.
// Реальный вызов telegram-gateway происходит не чаще одного раза в этот
// период на сессию — именно это не даёт каждому запросу к каталогу ходить
// во внешний сервис.
const RECHECK_HOURS = Number(process.env.WEB_SUBSCRIPTION_RECHECK_HOURS ?? 24);
const RECHECK_MS = RECHECK_HOURS * 60 * 60 * 1000;

// Кэш самой записи сессии — отдельно от кэша результата подписки. Нужен
// потому, что middleware висит на горячем пути каталога, а /favorites не
// проходит через resolveRole и своего чтения пользователя не имеет: без
// кэша каждый запрос делал бы лишний SELECT. TTL как у resolveRole.
const SESSION_CACHE_TTL_MS = 30_000;

interface CachedSession {
  revoked: boolean;
  subscriptionOk: boolean;
  lastSubscriptionCheckAt: Date | null;
  // Поля пользователя, которые требует checkWhitelistAccess — тянем их
  // одним include вместе с сессией. Без них перепроверка не смогла бы
  // применить whitelist и отписавшийся forceAllow-пользователь получил бы
  // отказ (в Mini App он проходит).
  telegramId: bigint;
  username: string | null;
  firstName: string;
  lastName: string | null;
  expiresAt: number;
}

const sessionCache = new Map<string, CachedSession>();

function invalidate(sessionId: string): void {
  sessionCache.delete(sessionId);
}

async function loadSession(sessionId: string): Promise<CachedSession | null> {
  const cached = sessionCache.get(sessionId);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const session = await prisma.webSession.findUnique({
    where: { id: sessionId },
    select: {
      revoked: true,
      subscriptionOk: true,
      lastSubscriptionCheckAt: true,
      // см. комментарий к CachedSession — это поля для checkWhitelistAccess
      user: { select: { telegramId: true, username: true, firstName: true, lastName: true } },
    },
  });
  if (!session) return null;

  const entry: CachedSession = {
    revoked: session.revoked,
    subscriptionOk: session.subscriptionOk,
    lastSubscriptionCheckAt: session.lastSubscriptionCheckAt,
    telegramId: session.user.telegramId,
    username: session.user.username,
    firstName: session.user.firstName,
    lastName: session.user.lastName,
    expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
  };
  sessionCache.set(sessionId, entry);
  return entry;
}

/**
 * Прогоняет реальную проверку подписки и записывает результат на сессию.
 * Экспортируется — этим же занимается POST /auth/subscription-recheck.
 *
 * fail-open при недоступности gateway: checkTelegramSubscriptionDetailed
 * сам возвращает isSubscriber=true, если шлюз не ответил. Это осознанное
 * решение проекта (то же самое в Mini App) — лучше пустить всех, чем
 * закрыть каталог из-за чужого сбоя.
 */
export async function refreshSessionSubscription(params: {
  sessionId: string;
  telegramId: bigint;
  username: string | null;
  firstName: string;
  lastName: string | null;
}): Promise<boolean> {
  const { sessionId, telegramId, username, firstName, lastName } = params;

  const subResult = await checkTelegramSubscriptionDetailed(Number(telegramId));
  const { effectiveIsSubscriber } = await checkWhitelistAccess({
    telegramId: Number(telegramId),
    username: username ?? undefined,
    firstName,
    lastName: lastName ?? undefined,
    subResult,
  });

  await prisma.webSession.update({
    where: { id: sessionId },
    data: { subscriptionOk: effectiveIsSubscriber, lastSubscriptionCheckAt: new Date() },
  });
  invalidate(sessionId);

  return effectiveIsSubscriber;
}

export const enforceWebSubscription = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const sessionId = req.user?.sessionId;
  // Гость или Mini App — не наш случай (см. шапку файла).
  if (!sessionId) {
    next();
    return;
  }

  try {
    const session = await loadSession(sessionId);

    // Сессии нет (отозвана и вычищена, либо токен выдан до внедрения
    // WebSession) — заставляем перелогиниться. Это же подстраховка на
    // случай легаси-токенов, которые не попали под миграцию-отзыв.
    if (!session || session.revoked) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const stale =
      session.lastSubscriptionCheckAt === null ||
      Date.now() - session.lastSubscriptionCheckAt.getTime() >= RECHECK_MS;

    if (stale) {
      // Гонка: два параллельных запроса с протухшей отметкой сходят в
      // gateway оба. Принято осознанно — окно узкое (закрывается сразу
      // после первого ответа), а in-flight lock здесь дороже проблемы.
      const ok = await refreshSessionSubscription({
        sessionId,
        telegramId: session.telegramId,
        username: session.username,
        firstName: session.firstName,
        lastName: session.lastName,
      });
      if (!ok) {
        res.status(403).json({ error: "subscription_required" });
        return;
      }
      next();
      return;
    }

    if (!session.subscriptionOk) {
      res.status(403).json({ error: "subscription_required" });
      return;
    }

    next();
  } catch (error) {
    // Своя ошибка (БД недоступна) не должна закрывать каталог — тот же
    // fail-open, что и у проверки подписки.
    console.error("[enforceWebSubscription] failed:", error);
    next();
  }
};

// Сброс кэша сессии извне — вызывается там, где сессию отзывают, чтобы
// отзыв вступал в силу сразу, а не через SESSION_CACHE_TTL_MS.
export function invalidateSessionCache(sessionId: string): void {
  invalidate(sessionId);
}

/**
 * Полный сброс кэша сессий.
 *
 * Вызывается там, где сессии гасят пачкой и их id под рукой нет: logout,
 * revokeAccess, смена/сброс пароля, снятие WEB_ACCESS. Без сброса отзыв
 * доходил бы до middleware только через SESSION_CACHE_TTL_MS — для выхода
 * из аккаунта это заметная дыра.
 *
 * Чистим кэш целиком, а не выборочно: обратного индекса userId -> sessionId
 * нет, а размер кэша — единицы записей на процесс (TTL 30 секунд). Строить
 * ради этого индекс дороже, чем изредка перечитать несколько сессий.
 */
export function clearSessionCache(): void {
  sessionCache.clear();
}
