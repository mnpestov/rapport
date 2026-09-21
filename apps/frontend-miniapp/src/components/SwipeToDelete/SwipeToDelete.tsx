import React, { useRef, useState } from 'react';
import { SquarePen, Trash2 } from 'lucide-react';
import './SwipeToDelete.css';

// Ширина ОДНОЙ кнопки под карточкой — свайп короче половины итоговой
// открытой ширины возвращает карточку на место, длиннее — докрывает до
// конца (тот же порог используется и для открытия, и для решения, довести
// ли анимацию до конца при отпускании). Итоговая ширина — одна кнопка
// (только Удалить, как раньше — swatches/карточки пряжи) или две (плюс
// Редактировать слева от неё — карточки списания), в зависимости от того,
// передан ли onRequestEdit. Кнопки — иконки (Trash2/SquarePen, та же, что
// у .stash-details-edit-button), не текст: "Редактировать" не помещалось
// на компактной ширине кнопки.
const BUTTON_WIDTH = 56;

interface SwipeToDeleteProps {
  isOpen: boolean;
  onSwipeOpen: () => void;
  onSwipeClose: () => void;
  onTap: () => void;
  onRequestDelete: () => void;
  deleteLabel?: string;
  // Опционально — если не передан, поведение то же, что раньше (одна
  // кнопка «Удалить»). Передан → под карточкой появляется вторая кнопка
  // «Редактировать» слева от «Удалить», ширина свайпа увеличивается вдвое.
  onRequestEdit?: () => void;
  editLabel?: string;
  children: React.ReactNode;
  cardClassName?: string;
}

// Общая свайп-логика для карточек списка (карточка пряжи в хранилище,
// карточка списания в разделе "Связано") — свайп влево открывает кнопку
// удаления фирменного цвета под карточкой. Родитель отвечает за то, ЧТО
// внутри карточки (children) и что происходит по тапу/удалению, этот
// компонент — только за жест.
export const SwipeToDelete: React.FC<SwipeToDeleteProps> = ({
  isOpen,
  onSwipeOpen,
  onSwipeClose,
  onTap,
  onRequestDelete,
  deleteLabel = 'Удалить',
  onRequestEdit,
  editLabel = 'Редактировать',
  children,
  cardClassName = '',
}) => {
  const openWidth = onRequestEdit ? BUTTON_WIDTH * 2 : BUTTON_WIDTH;
  const openThreshold = openWidth / 2;
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  // Отличает свайп от тапа — тап должен сработать, свайп не должен.
  const movedRef = useRef(false);
  // null — направление ещё не определено (движение только начинается,
  // слишком маленькое, чтобы понять намерение). true — жест распознан как
  // вертикальный скролл, горизонтальный сдвиг карточки в этом касании
  // больше не применяется вообще (не просто "малое движение": однажды
  // определённый как скролл жест остаётся скроллом до touchend, иначе
  // рука, слегка выправившая траекторию на середине скролла, дёргала бы
  // карточку). false — жест распознан как горизонтальный свайп.
  const isVerticalScrollRef = useRef<boolean | null>(null);

  const baseOffset = isOpen ? -openWidth : 0;
  const offset = isDragging ? dragX : baseOffset;

  const handleTouchStart = (e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
    draggingRef.current = true;
    setIsDragging(true);
    movedRef.current = false;
    isVerticalScrollRef.current = null;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startXRef.current == null || startYRef.current == null) return;
    const deltaX = e.touches[0].clientX - startXRef.current;
    const deltaY = e.touches[0].clientY - startYRef.current;

    if (isVerticalScrollRef.current === null) {
      // Ждём, пока жест наберёт хотя бы 16px в одном из направлений — было
      // 8px, но этого хватало на случайное дрожание руки при обычном
      // вертикальном скролле, из-за чего карточка открывалась сама.
      if (Math.hypot(deltaX, deltaY) < 16) return;
      isVerticalScrollRef.current = Math.abs(deltaY) > Math.abs(deltaX);
    }

    if (isVerticalScrollRef.current) return; // это скролл страницы, карточку не двигаем

    if (Math.abs(deltaX) > 4) movedRef.current = true;
    // Свайп только влево из закрытого состояния, только вправо (закрытие)
    // из открытого — не даём утянуть карточку за пределы [-width, 0].
    const next = Math.min(0, Math.max(-openWidth, baseOffset + deltaX));
    setDragX(next);
  };

  const handleTouchEnd = () => {
    draggingRef.current = false;
    setIsDragging(false);
    startXRef.current = null;
    startYRef.current = null;
    if (isVerticalScrollRef.current) {
      // Скролл — оставляем карточку в текущем состоянии как было (баг:
      // без этой ветки onSwipeClose() ниже закрывал бы уже открытую
      // карточку на каждый вертикальный скролл мимо нее).
      isVerticalScrollRef.current = null;
      return;
    }
    isVerticalScrollRef.current = null;
    if (dragX <= -openThreshold) {
      onSwipeOpen();
    } else {
      onSwipeClose();
    }
  };

  const handleClick = () => {
    if (movedRef.current) return; // это был свайп, не тап
    if (isOpen) {
      onSwipeClose();
      return;
    }
    onTap();
  };

  // Клик по любой кнопке под карточкой должен вернуть её в закрытое
  // состояние — иначе после закрытия модалки (редактирование/удаление)
  // пользователь видит ту же открытую карточку с висящими кнопками.
  const handleRequestDelete = () => {
    onSwipeClose();
    onRequestDelete();
  };
  const handleRequestEdit = () => {
    onSwipeClose();
    onRequestEdit?.();
  };

  return (
    <div className="swipe-to-delete">
      {onRequestEdit && (
        <button
          type="button"
          className="swipe-to-delete-button swipe-to-delete-button--edit"
          onClick={handleRequestEdit}
          aria-label={editLabel}
        >
          <SquarePen size={20} strokeWidth={1.5} />
        </button>
      )}
      <button
        type="button"
        className="swipe-to-delete-button"
        onClick={handleRequestDelete}
        aria-label={deleteLabel}
      >
        <Trash2 size={20} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        className={`swipe-to-delete-content ${cardClassName}${isDragging ? ' swipe-to-delete-dragging' : ''}`}
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleClick}
      >
        {children}
      </button>
    </div>
  );
};
