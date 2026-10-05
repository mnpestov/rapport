// Блокировка скролла body на время открытой шторки — стандартный паттерн
// (тот же, что в react-remove-scroll и подобных библиотеках): простого
// overflow:hidden на iOS Safari недостаточно (body всё равно "резинится"),
// нужен position:fixed с компенсирующим top, сохраняющим текущую позицию
// скролла визуально на месте.
//
// Побочный эффект, ради которого это вообще нужно (FilterModal и т.п.):
// пока body физически не скроллится, у iOS нет повода автоскроллить
// страницу к сфокусированному инпуту внутри шторки — именно этот
// автоскролл двигает fixed-оверлей шторки (см. useVisualViewportInset.ts).
// На Android с resize-моделью viewport то же самое не даёт layout-viewport
// пересчитаться "подо мной" пока открыта шторка.
//
// Реф-каунтер — на случай если две шторки со scroll-lock открыты
// одновременно (например, FilterModal → поверх неё ReportErrorModal):
// снимать блокировку должен только ПОСЛЕДНИЙ закрывшийся, восстанавливать
// скролл — к позиции, сохранённой САМЫМ ПЕРВЫМ открытием.
let lockCount = 0;
let savedScrollY = 0;

export function lockBodyScroll(): void {
  if (lockCount === 0) {
    savedScrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
  }
  lockCount += 1;
}

export function unlockBodyScroll(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    window.scrollTo(0, savedScrollY);
  }
}
