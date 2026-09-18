import React from 'react';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import '../../styles/sheet.css';
import './DeleteConfirmModal.css';

interface DeleteConfirmModalProps {
  isOpen: boolean;
  title: string;
  text: string;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  title,
  text,
  isDeleting,
  onCancel,
  onConfirm,
}) => {
  const { isMounted, isVisible, sheetRef } = useSheetTransition(isOpen);

  if (!isMounted) return null;

  return (
    <div ref={sheetRef} className={`delete-confirm-overlay sheet-overlay ${isVisible ? 'sheet-open' : ''}`} onClick={onCancel}>
      <div className="delete-confirm-panel sheet-panel" onClick={(e) => e.stopPropagation()}>
        <p className="delete-confirm-title">{title}</p>
        <p className="delete-confirm-text">{text}</p>
        <div className="delete-confirm-actions">
          <button type="button" className="btn delete-confirm-cancel" onClick={onCancel} disabled={isDeleting}>
            Отмена
          </button>
          <button type="button" className="btn delete-confirm-confirm" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? 'Удаление...' : 'Удалить'}
          </button>
        </div>
      </div>
    </div>
  );
};
