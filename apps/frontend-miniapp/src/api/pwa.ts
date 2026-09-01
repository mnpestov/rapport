/**
 * Установка приложения на рабочий стол телефона (PWA).
 *
 * Работает ТОЛЬКО в браузерном режиме. Внутри Telegram Mini App регистрация
 * Service Worker бессмысленна (приложение и так «установлено» как Mini App)
 * и потенциально мешает — поэтому режим проверяется до любых действий.
 *
 * Два пути:
 *  - Android/Chrome: браузер сам присылает событие beforeinstallprompt,
 *    его можно «придержать» и показать по нажатию своей кнопки.
 *  - iOS/Safari: события нет вовсе (ограничение Apple). Остаётся показать
 *    инструкцию «Поделиться → На экран «Домой»».
 */

import { isWebMode } from './authSession';

// Тип события beforeinstallprompt — в lib.dom его нет.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

/** Событие для UI: доступность установки изменилась — обнови кнопку. */
export const PWA_INSTALLABLE_EVENT = 'pwa:installable-changed';

export function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ маскируется под Mac — ловим по тач-поинтам.
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

/** Уже запущено как установленное приложение (standalone) — кнопку не показываем. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS-специфичный флаг
    (navigator as any).standalone === true
  );
}

/**
 * Можно ли прямо сейчас показать нативный промт установки (Android).
 * Для iOS всегда false — там только инструкция, см. shouldShowIosHint().
 */
export function canPromptInstall(): boolean {
  return deferredPrompt !== null;
}

/** Показывать ли подсказку для iOS (не в Telegram, не уже установлено). */
export function shouldShowIosHint(): boolean {
  return isWebMode() && isIos() && !isStandalone();
}

/**
 * Вызвать нативный промт установки (Android). Возвращает true, если
 * пользователь согласился. После первого вызова событие «тратится» —
 * повторно показать нельзя до перезагрузки.
 */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  const evt = deferredPrompt;
  deferredPrompt = null;
  window.dispatchEvent(new CustomEvent(PWA_INSTALLABLE_EVENT));
  await evt.prompt();
  const choice = await evt.userChoice;
  return choice.outcome === 'accepted';
}

/**
 * Регистрация Service Worker + перехват beforeinstallprompt.
 * Идемпотентна, вызывается один раз при старте.
 */
export function initPwa(): void {
  if (!isWebMode()) return;

  if ('serviceWorker' in navigator) {
    // После загрузки страницы, чтобы не конкурировать за сеть с первыми
    // запросами приложения.
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('[pwa] SW registration failed:', err);
      });
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    // Отменяем автоплашку Chrome — покажем установку по своей кнопке.
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    window.dispatchEvent(new CustomEvent(PWA_INSTALLABLE_EVENT));
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    window.dispatchEvent(new CustomEvent(PWA_INSTALLABLE_EVENT));
  });
}
