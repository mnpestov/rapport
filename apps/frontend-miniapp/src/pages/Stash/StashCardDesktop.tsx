import React from 'react';
import { Trash2 } from 'lucide-react';
import { StashSkein } from '../../api/stashApi';
import yarnPlaceholder from '../../assets/stash/yarn-placeholder.png';

interface StashCardDesktopProps {
  item: StashSkein;
  onOpen: () => void;
  onRequestDelete: () => void;
}

// Десктопный аналог SwipeableStashCard.tsx (Figma node-id=1651:21630) — те
// же данные и расчёт остатка, другая разметка: горизонтальная карточка в
// сетке 3 колонки, без свайп-жеста (не нужен на десктопе — есть курсор),
// удаление — явная иконка корзины, открывающая тот же DeleteConfirmModal,
// что и мобильный свайп (состояние deleteTarget/isDeleting — в Stash.tsx,
// общее для обоих вариантов карточки).
export const StashCardDesktop: React.FC<StashCardDesktopProps> = ({ item, onOpen, onRequestDelete }) => {
  const remainderPercent = item.totalWeightG > 0
    ? Math.round((item.currentWeightG / item.totalWeightG) * 100)
    : 0;

  return (
    <div className="stash-card-desktop">
      <button type="button" className="stash-card-desktop-main" onClick={onOpen}>
        <div className="stash-card-desktop-image">
          <img src={item.images[0] || yarnPlaceholder} alt="" className={item.images[0] ? '' : 'stash-card-image-placeholder'} />
        </div>
        <div className="stash-card-desktop-body">
          <p className="stash-card-desktop-name">{item.yarnNameSnapshot}</p>
          {item.brandSnapshot && (
            <p className="stash-card-desktop-row"><b>Бренд:</b> {item.brandSnapshot}</p>
          )}
          {item.compositionSnapshot && (
            <p className="stash-card-desktop-row"><b>Состав:</b> {item.compositionSnapshot}</p>
          )}
          {item.mPer100gSnapshot != null && (
            <p className="stash-card-desktop-row"><b>Метраж:</b> {item.mPer100gSnapshot}м/100г</p>
          )}
          <div className="stash-card-desktop-remainder">
            <p className="stash-card-desktop-row">
              <b>Остаток:</b> {item.currentWeightG} г из {item.totalWeightG} г
            </p>
            <div className="stash-card-progress-bar stash-card-desktop-progress-bar">
              <div className="stash-card-progress-fill" style={{ width: `${remainderPercent}%` }} />
            </div>
          </div>
        </div>
      </button>
      {/* <button type="button" className="stash-card-desktop-delete" onClick={onRequestDelete} aria-label="Удалить">
        <Trash2 size={16} strokeWidth={1.5} />
      </button> */}
      <button type="button" className="stash-card-desktop-delete" onClick={onRequestDelete} aria-label="Удалить">
        <Trash2 strokeWidth={1.5} />
      </button>
    </div>
  );
};
