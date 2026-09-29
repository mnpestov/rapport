import React from 'react';
import './BackdatedCompletionNotice.css';

interface BackdatedCompletionNoticeProps {
  isOpen: boolean;
  onClose: () => void;
}

// Показывается один раз за сессию формы (создание сразу завершённым или
// визард завершения) — при первом фокусе на поле расхода пряжи. Объясняет
// backdated-механику: остаток мотка в хранилище не уменьшается, потому что
// расход уже произошёл в прошлом, до заведения мотка в приложение —
// уменьшается только общий вес мотка (см. PROJECTS_PLAN.md §1.4/§4.4).
export const BackdatedCompletionNotice: React.FC<BackdatedCompletionNoticeProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    // stopPropagation здесь обязателен: этот оверлей рендерится ВНУТРИ
    // оверлея визарда/формы (не в портале), и без остановки всплытия клик
    // по фону нотиса долетает до родительского overlay.onClick и закрывает
    // весь визард завершения проекта целиком (баг: клик по полю расхода →
    // нотис мелькает и пропадает → форма закрывается, статус не меняется).
    <div className="backdated-notice-overlay" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="backdated-notice-panel" onClick={(e) => e.stopPropagation()}>
        <p className="backdated-notice-title">Это задним числом</p>
        <p className="backdated-notice-text">
          Проект уже завершён, поэтому расход пряжи, который вы укажете, не уменьшит остаток мотка в хранилище —
          изменится только его общий вес. Так остаток остаётся верным для пряжи, которую вы ещё продолжаете использовать.
        </p>
        <button type="button" className="btn backdated-notice-btn" onClick={onClose}>Понятно</button>
      </div>
    </div>
  );
};
