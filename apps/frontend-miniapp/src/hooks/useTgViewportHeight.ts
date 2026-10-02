import { useEffect } from 'react';

/**
 * Синхронизирует высоту visible-viewport Telegram Mini App с CSS-переменной
 * --tg-vh на <html>. Вызывается один раз глобально в App.tsx.
 *
 * Проблема: клавиатура в Telegram Mini App ведёт себя по-разному:
 * - iOS: viewport НЕ сжимается, клавиатура просто перекрывает нижнюю часть.
 *   Footer с flex-shrink:0 остаётся внизу 100dvh-панели и уходит под клавиатуру.
 * - Android: viewport сжимается, и 100dvh пересчитывается — footer «прыгает»
 *   вверх, перекрывая контент.
 *
 * Решение: Telegram SDK предоставляет viewportHeight — реальная видимая
 * высота окна приложения с учётом клавиатуры. Подписываемся на событие
 * viewportChanged и обновляем --tg-vh. CSS панелей использует эту переменную
 * вместо 100dvh: height: var(--tg-vh, 100dvh).
 *
 * Fallback: когда SDK не доступен (браузер вне Telegram), переменная не
 * устанавливается — применяется fallback 100dvh, поведение прежнее.
 */
export function useTgViewportHeight(): void {
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg) return;

    const update = () => {
      const h = tg.viewportHeight as number | undefined;
      if (h && h > 0) {
        document.documentElement.style.setProperty('--tg-vh', `${h}px`);
      }
    };

    // Установить немедленно при монтировании.
    update();

    // Обновлять при каждом изменении viewport (открытие/закрытие клавиатуры,
    // разворот экрана, переключение между expand/compact видом Mini App).
    tg.onEvent('viewportChanged', update);

    return () => {
      tg.offEvent('viewportChanged', update);
    };
  }, []);
}
