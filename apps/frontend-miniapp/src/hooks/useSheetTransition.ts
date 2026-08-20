import { useEffect, useLayoutEffect, useRef, useState } from "react";

// Длительность анимации ЗАКРЫТИЯ шторки — именно она определяет, когда
// безопасно размонтировать содержимое (при открытии размонтирования нет,
// так что длительность входа здесь не участвует). Должна совпадать с
// длительностью выхода в styles/sheet.css, где вход и выход намеренно
// разной длины: 400ms на появление, 300ms на закрытие.
export const SHEET_TRANSITION_MS = 300;

export interface SheetTransition {
  // Держать ли компонент в дереве. Остаётся true всё время анимации
  // закрытия — иначе `if (!isOpen) return null` убирал бы шторку мгновенно
  // и выезд вниз просто не успевал бы отрисоваться.
  isMounted: boolean;
  // Отвечает за класс, по которому CSS переводит шторку в открытое
  // положение.
  isVisible: boolean;
  // Вешается на корневой элемент шторки (оверлей). Нужен, чтобы принудить
  // браузер вычислить закрытое состояние до включения открытого — см.
  // разбор в useLayoutEffect ниже.
  sheetRef: React.RefObject<HTMLDivElement>;
}

export function useSheetTransition(isOpen: boolean): SheetTransition {
  const [isMounted, setIsMounted] = useState(isOpen);
  // ВСЕГДА false на старте, даже если шторка монтируется уже открытой.
  // Раньше здесь стояло useState(isOpen), и в этом случае первый же кадр
  // рисовался сразу в открытом состоянии — переходить было не от чего, и
  // появление выглядело мгновенным. Ловилось на баннере подписки, который
  // монтируется одновременно с выставлением isOpen (App.tsx показывает его
  // сразу после авторизации).
  const [isVisible, setIsVisible] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setIsMounted(true);
      return;
    }
    setIsVisible(false);
    const timer = setTimeout(() => setIsMounted(false), SHEET_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [isOpen]);

  // Открытие включается здесь, а не в обычном useEffect с requestAnimationFrame,
  // как было раньше. Причина отказа от rAF: он лишь угадывал момент, когда
  // React уже создал узел в закрытом состоянии. Под нагрузкой (или при
  // двойном прогоне эффектов в StrictMode) оба кадра успевали отработать до
  // коммита, isVisible попадал в тот же коммит, что и isMounted, и переход
  // не запускался — отсюда "иногда плавно, иногда мгновенно".
  //
  // useLayoutEffect же гарантированно выполняется после коммита, создавшего
  // узел, и до отрисовки. Чтение offsetHeight принудительно вычисляет
  // текущий (закрытый) стиль, поэтому следующая же смена класса на открытый
  // воспринимается браузером как изменение, которое нужно анимировать, а не
  // как начальное значение.
  useLayoutEffect(() => {
    if (!isMounted || !isOpen || isVisible) return;
    void sheetRef.current?.offsetHeight;
    setIsVisible(true);
  }, [isMounted, isOpen, isVisible]);

  return { isMounted, isVisible, sheetRef };
}
