import { Request } from "express";

/**
 * Откуда пришёл запрос — из браузерной версии или из Telegram Mini App
 * (BROWSER_ACCESS_PLAN.md §4.5, P2).
 *
 * Признак берётся из самого токена, а не из заголовков и не из тела: claim
 * sessionId есть ТОЛЬКО у токенов браузерного входа (его кладёт
 * createWebSession), и подделать его нельзя — токен подписан. Заголовок
 * вроде X-Platform клиент мог бы прислать любой.
 *
 * Гость без токена помечается как 'miniapp': аналитические эндпоинты все
 * под requireAuth, так что до записи события такой запрос не дойдёт, а
 * значение по умолчанию должно совпадать с историей (до появления веба всё
 * было из Mini App).
 */
export type EventPlatform = "web" | "miniapp";

export function requestPlatform(req: Request): EventPlatform {
  return req.user?.sessionId ? "web" : "miniapp";
}
