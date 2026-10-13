/*
 * Минимальный Service Worker.
 *
 * Существует ТОЛЬКО ради установки PWA: Chrome на Android не покажет
 * «Установить приложение» и не выдаст событие beforeinstallprompt, пока у
 * сайта нет зарегистрированного SW с обработчиком fetch.
 *
 * Намеренно НЕ кэширует ничего: приложение сильно завязано на свежие данные
 * (каталог, подписка, сессия), и офлайн-кэш скорее навредил бы —
 * показывал бы устаревшее.
 *
 * skipWaiting + clients.claim — чтобы обновлённый SW применялся сразу, а не
 * ждал закрытия всех вкладок. Раз он ничего не кэширует, ломать нечего.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Обработчик нужен лишь для того, чтобы SW вообще считался "с fetch-
// обработчиком" (Chrome иначе не предложит установку PWA) — тело пустое,
// event.respondWith() НЕ вызывается вовсе. Раньше здесь стоял
// event.respondWith(fetch(event.request)) — выглядит как passthrough, но
// это повторный fetch ЧЕРЕЗ Service Worker, не то же самое, что "браузер
// обработал запрос сам". Для некоторых запросов (спекулятивная подгрузка/
// восстановление вкладки на Android Chrome) исходный Request помечен
// внутренним cache: 'only-if-cached' — повторный fetch(event.request) с
// таким флагом падает с net::ERR_CACHE_MISS, если ответа нет в HTTP-кэше.
// Без event.respondWith() браузер выполняет запрос напрямую, минуя эту
// проблему целиком.
self.addEventListener('fetch', () => {});
