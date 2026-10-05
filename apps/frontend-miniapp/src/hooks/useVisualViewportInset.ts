import { useEffect } from 'react';

/**
 * Синхронизирует CSS-переменную --vv-bottom-inset с реальной высотой,
 * перекрытой экранной клавиатурой — используется fixed-элементами (таб-бар,
 * футеры модалок), чтобы они не "подскакивали" при фокусе на инпуте.
 *
 * Формула — ПРОСТОЕ живое сравнение, без запомненного baseline и без
 * vv.offsetTop. Предыдущая версия держала оба и ломалась в обеих моделях
 * поведения клавиатуры:
 *
 * - vv.offsetTop — на iOS при автоскролле к сфокусированному инпуту этот
 *   сдвиг растёт примерно на ту же величину, на которую vv.height
 *   уменьшается клавиатурой — в сумме (vv.height + vv.offsetTop) гасило
 *   само себя обратно к исходной высоте, и inset получался ~0 именно
 *   тогда, когда компенсация нужнее всего.
 * - baseline (высота, замороженная ДО появления клавиатуры) — в моделях,
 *   где window.innerHeight реально уменьшается вместе с клавиатурой
 *   (часть Android WebView, включая Telegram), position:fixed;bottom:0 и
 *   без JS уже корректно пересчитывается браузером на новую уменьшенную
 *   границу экрана — никакой доп. компенсации не требуется. Сравнение с
 *   ЗАМОРОЖЕННЫМ baseline в этом случае всё равно давало inset ≈ высота
 *   клавиатуры и ДВОЙНО поднимало фикс-элемент: один раз — уже корректным
 *   нативным пересчётом, второй раз — этой переменной поверх него.
 *
 * Простое window.innerHeight - vv.height (оба значения — живые, без
 * запоминания) даёт верный результат в обеих моделях сразу:
 * - iOS (innerHeight не меняется, vv.height уменьшился на K): inset = K.
 * - Android resize (оба уменьшились на K): inset ≈ 0 — бразуер уже всё
 *   сделал сам, доп. компенсация не нужна и не применяется.
 */
export function useVisualViewportInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;

    const update = () => {
      const visibleHeight = vv ? vv.height : window.innerHeight;
      const inset = Math.max(0, window.innerHeight - visibleHeight);
      document.documentElement.style.setProperty('--vv-bottom-inset', `${inset}px`);
    };

    update();
    window.addEventListener('resize', update);
    vv?.addEventListener('resize', update);

    return () => {
      window.removeEventListener('resize', update);
      vv?.removeEventListener('resize', update);
    };
  }, []);
}
