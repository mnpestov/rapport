import React, { useEffect, useRef, useState } from 'react';
import { EllipsisVertical, SquarePen, Trash2 } from 'lucide-react';
import './HeaderActionsMenu.css';

interface HeaderActionsMenuProps {
  // Опционально — у карточки "Пряжа" в проекте нет своего редактирования
  // (в отличие от "Образца"/шапки карточки), без onEdit пункт
  // "Редактировать" просто не рендерится.
  onEdit?: () => void;
  onDelete: () => void;
}

// Кнопка "..." в правом верхнем углу карточки (пряжи/проекта) — вместо
// прежней одиночной кнопки-карандаша. Раскрывает меню с двумя пунктами:
// Редактировать/Удалить. Заменяет собой и старую кнопку редактирования в
// шапке, и кнопку "Удалить проект" снизу карточки — оба действия теперь
// живут в одном месте.
export const HeaderActionsMenu: React.FC<HeaderActionsMenuProps> = ({ onEdit, onDelete }) => {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isOpen]);

  return (
    <div ref={rootRef} className="header-actions-menu">
      <button
        type="button"
        className="header-actions-menu-trigger"
        onClick={() => setIsOpen((v) => !v)}
        aria-label="Действия"
      >
        <EllipsisVertical size={24} stroke="#9B9A9A" />
      </button>
      {isOpen && (
        <div className="header-actions-menu-list">
          {onEdit && (
            <button
              type="button"
              className="header-actions-menu-item"
              onClick={() => { setIsOpen(false); onEdit(); }}
            >
              <SquarePen size={18} />
              Редактировать
            </button>
          )}
          <button
            type="button"
            className="header-actions-menu-item header-actions-menu-item--danger"
            onClick={() => { setIsOpen(false); onDelete(); }}
          >
            <Trash2 size={18} />
            Удалить
          </button>
        </div>
      )}
    </div>
  );
};
