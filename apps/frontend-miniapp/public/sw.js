/*
 * Минимальный Service Worker.
 *
 * Существует ТОЛЬКО ради установки PWA: Chrome на Android не покажет
 * «Установить приложение» и не выдаст событие beforeinstallprompt, пока у
 * сайта нет зарегистрированного SW с обработчиком fetch.
 *
 * Намеренно НЕ кэширует ничего: приложение сильно завязано на свежие данные
 * (каталог, подписка, сессия), и офлайн-кэш скорее навредил бы —
 * показывал бы устаревшее. fetch просто проксируется в сеть без изменений.
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

self.addEventListener('fetch', (event) => {
  // Passthrough. Не вызываем event.respondWith без нужды — пусть браузер
  // обрабатывает запрос сам, как будто SW и нет. Обработчик нужен лишь для
  // того, чтобы он в принципе присутствовал.
  event.respondWith(fetch(event.request));
});
