import { useEffect, useState } from "react";

// Единый брейкпоинт десктопа — тот же 768px, на котором завязаны адаптивы
// в CSS (Catalog.css, PatternDetails.css, FilterModal.css).
const DESKTOP_QUERY = "(min-width: 768px)";

// Нужен там, где на десктопе и мобиле разная РАЗМЕТКА, а не только стили:
// шторка снизу против выпадающего селекта у кнопки сортировки. Для чисто
// визуальных различий по-прежнему хватает @media в CSS.
export const useIsDesktop = (): boolean => {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", onChange);
    // Синхронизируемся на случай, если ширина изменилась между первым
    // рендером и монтированием (например, поворот экрана при загрузке).
    setIsDesktop(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
};
