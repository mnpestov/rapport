import React, { useRef, useState } from 'react';
import './SwipeToDelete.css';

// Ширина открытой кнопки «Удалить» под карточкой — свайп короче этого
// расстояния возвращает карточку на место, длиннее — докрывает до конца
// (тот же порог используется и для открытия, и для решения, довести ли
// анимацию до конца при отпускании).
const DELETE_BUTTON_WIDTH = 88;
const OPEN_THRESHOLD = DELETE_BUTTON_WIDTH / 2;

interface SwipeToDeleteProps {
  isOpen: boolean;
  onSwipeOpen: () => void;
  onSwipeClose: () => void;
  onTap: () => void;
  onRequestDelete: () => void;
  deleteLabel?: string;
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
  children,
  cardClassName = '',
}) => {
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  // Отличает свайп от тапа — тап должен сработать, свайп не должен.
  const movedRef = useRef(false);

  const baseOffset = isOpen ? -DELETE_BUTTON_WIDTH : 0;
  const offset = isDragging ? dragX : baseOffset;

  const handleTouchStart = (e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    draggingRef.current = true;
    setIsDragging(true);
    movedRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startXRef.current == null) return;
    const delta = e.touches[0].clientX - startXRef.current;
    if (Math.abs(delta) > 4) movedRef.current = true;
    // Свайп только влево из закрытого состояния, только вправо (закрытие)
    // из открытого — не даём утянуть карточку за пределы [-width, 0].
    const next = Math.min(0, Math.max(-DELETE_BUTTON_WIDTH, baseOffset + delta));
    setDragX(next);
  };

  const handleTouchEnd = () => {
    draggingRef.current = false;
    setIsDragging(false);
    startXRef.current = null;
    if (dragX <= -OPEN_THRESHOLD) {
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

  return (
    <div className="swipe-to-delete">
      <button type="button" className="swipe-to-delete-button" onClick={onRequestDelete}>
        {deleteLabel}
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
