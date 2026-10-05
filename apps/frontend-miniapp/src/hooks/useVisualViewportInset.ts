import { useEffect } from 'react';

function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}

/**
 * Синхронизирует CSS-переменную --vv-bottom-inset с реальной высотой,
 * перекрытой экранной клавиатурой — используется fixed-элементами (таб-бар,
 * футеры модалок), чтобы они не "подскакивали" при фокусе на инпуте.
 *
 * Почему недостаточно просто сравнить window.innerHeight с
 * window.visualViewport.height "на лету": поведение клавиатуры различается
 * не только между iOS/Android, но и между версиями WebView внутри самого
 * Telegram-клиента —
 * - "современная" модель (iOS Safari, свежий Chrome с
 *   interactive-widget=resizes-visual по умолчанию): window.innerHeight НЕ
 *   меняется, сжимается только visualViewport — тогда разница между ними
 *   корректно равна высоте клавиатуры.
 * - "классическая" модель (часть Android WebView, в т.ч. встроенный в
 *   Telegram): window.innerHeight меняется ВМЕСТЕ с клавиатурой — тогда
 *   сравнение innerHeight с visualViewport "на лету" всегда даёт ~0, хотя
 *   клавиатура открыта, и это НЕ ошибка в фикс-позиционировании, а то, что
 *   у fixed-элементов пересчитывается bottom:0 относительно УЖЕ
 *   уменьшенного viewport — таб-бар просто наезжает на новую границу
 *   экрана, выглядит как прыжок вверх.
 *
 * Решение, которое работает в обеих моделях: запоминаем baseline —
 * window.innerHeight в момент, когда фокус точно НЕ стоит на
 * инпуте/textarea (т.е. клавиатуры точно нет) — и сравниваем текущую
 * видимую область с этим baseline, а не с живым innerHeight. Baseline
 * переснимается на resize/focusout, когда фокус не на редактируемом
 * элементе (значит это реальная смена размера экрана — поворот,
 * разворачивание Mini App, — а не клавиатура).
 */
export function useVisualViewportInset(): void {
  useEffect(() => {
    let baseline = window.innerHeight;

    const update = () => {
      const vv = window.visualViewport;
      const visibleBottom = vv ? vv.height + vv.offsetTop : window.innerHeight;
      const inset = Math.max(0, baseline - visibleBottom);
      document.documentElement.style.setProperty('--vv-bottom-inset', `${inset}px`);
    };

    const maybeRebaseline = () => {
      // Пока фокус на инпуте, любое уменьшение высоты считаем клавиатурой
      // (не трогаем baseline) — иначе "классическая" модель (см. комментарий
      // выше) приняла бы открытие клавиатуры за реальную смену размера
      // экрана и обнулила разницу.
      if (!isEditableElement(document.activeElement)) {
        baseline = window.innerHeight;
      }
    };

    const handleResize = () => {
      maybeRebaseline();
      update();
    };

    const handleFocusOut = () => {
      // Клавиатура обычно закрывается не мгновенно с blur — небольшая
      // задержка даёт innerHeight время вернуться к исходному значению до
      // переснятия baseline.
      setTimeout(() => {
        maybeRebaseline();
        update();
      }, 50);
    };

    update();
    window.addEventListener('resize', handleResize);
    document.addEventListener('focusin', update, true);
    document.addEventListener('focusout', handleFocusOut, true);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);

    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('focusin', update, true);
      document.removeEventListener('focusout', handleFocusOut, true);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);
}
