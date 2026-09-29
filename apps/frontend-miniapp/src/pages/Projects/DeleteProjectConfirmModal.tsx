import React from 'react';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import '../../styles/sheet.css';
import '../../components/DeleteConfirmModal/DeleteConfirmModal.css';

interface DeleteProjectConfirmModalProps {
  isOpen: boolean;
  projectTitle: string;
  // Проект без привязанной пряжи с расходом — вопрос про возврат веса не
  // имеет смысла, показываем обычное да/нет подтверждение (см.
  // PROJECTS_PLAN.md §2.5 — returnYarnToStash решает судьбу StashUsage,
  // только если она вообще есть).
  hasYarnUsages: boolean;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: (returnYarnToStash: boolean) => void;
}

// Явный выбор пользователя, куда девать списанную пряжу при удалении
// проекта — true возвращает вес мотку (или откатывает totalWeightG для
// backdated-записей), false оставляет историю расхода как есть, просто
// отвязывая её от удаляемого проекта (см. deleteProject на бэкенде).
export const DeleteProjectConfirmModal: React.FC<DeleteProjectConfirmModalProps> = ({
  isOpen,
  projectTitle,
  hasYarnUsages,
  isDeleting,
  onCancel,
  onConfirm,
}) => {
  const { isMounted, isVisible, sheetRef } = useSheetTransition(isOpen);

  if (!isMounted) return null;

  return (
    <div ref={sheetRef} className={`delete-confirm-overlay sheet-overlay ${isVisible ? 'sheet-open' : ''}`} onClick={onCancel}>
      <div className="delete-confirm-panel sheet-panel" onClick={(e) => e.stopPropagation()}>
        <p className="delete-confirm-title">Удалить проект?</p>
        <p className="delete-confirm-text">
          «{projectTitle}» будет удалён без возможности восстановить.
          {hasYarnUsages && ' Что сделать со списанной на него пряжей?'}
        </p>
        <div className="delete-confirm-actions">
          {hasYarnUsages ? (
            <>
              <button type="button" className="btn delete-confirm-cancel" onClick={() => onConfirm(true)} disabled={isDeleting}>
                {isDeleting ? 'Удаление...' : 'Вернуть пряжу в хранилище'}
              </button>
              <button type="button" className="btn delete-confirm-confirm" onClick={() => onConfirm(false)} disabled={isDeleting}>
                {isDeleting ? 'Удаление...' : 'Оставить расход как есть'}
              </button>
            </>
          ) : (
            <button type="button" className="btn delete-confirm-confirm" onClick={() => onConfirm(false)} disabled={isDeleting}>
              {isDeleting ? 'Удаление...' : 'Удалить'}
            </button>
          )}
          <button type="button" className="btn delete-confirm-cancel" onClick={onCancel} disabled={isDeleting}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
};
