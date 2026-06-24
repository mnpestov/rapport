import React from 'react';
import styles from './Modal.module.css';
import confirmStyles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'danger' | 'default';
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = "Подтвердить",
  cancelText = "Отмена",
  onConfirm,
  onCancel,
  variant = 'default',
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={confirmStyles.dialog} onClick={e => e.stopPropagation()}>
        <h3 className={confirmStyles.title}>{title}</h3>
        <p className={confirmStyles.message}>{message}</p>
        <div className={confirmStyles.actions}>
          <button className={confirmStyles.cancelBtn} onClick={onCancel}>
            {cancelText}
          </button>
          <button
            className={variant === 'danger' ? confirmStyles.dangerBtn : confirmStyles.confirmBtn}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
