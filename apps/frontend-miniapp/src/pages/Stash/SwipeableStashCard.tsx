import React from 'react';
import { StashSkein } from '../../api/stashApi';
import { SwipeToDelete } from '../../components/SwipeToDelete/SwipeToDelete';
import yarnPlaceholder from '../../assets/stash/yarn-placeholder.png';

interface SwipeableStashCardProps {
  item: StashSkein;
  onOpen: () => void;
  onRequestDelete: () => void;
  // Свайпнутая карточка закрывается, когда открывают другую — id открытой
  // карточки живёт в родителе (Stash.tsx), не здесь, иначе одновременно
  // могло бы остаться открытыми несколько кнопок удаления.
  isOpen: boolean;
  onSwipeOpen: () => void;
  onSwipeClose: () => void;
}

export const SwipeableStashCard: React.FC<SwipeableStashCardProps> = ({
  item,
  onOpen,
  onRequestDelete,
  isOpen,
  onSwipeOpen,
  onSwipeClose,
}) => {
  return (
    <SwipeToDelete
      isOpen={isOpen}
      onSwipeOpen={onSwipeOpen}
      onSwipeClose={onSwipeClose}
      onTap={onOpen}
      onRequestDelete={onRequestDelete}
      cardClassName="stash-card"
    >
      <div className="stash-card-image">
        <img src={item.images[0] || yarnPlaceholder} alt="" className={item.images[0] ? '' : 'stash-card-image-placeholder'} />
      </div>
      <div className="stash-card-body">
        <p className="stash-card-name">{item.yarnNameSnapshot}</p>
        {item.brandSnapshot && (
          <p className="stash-card-row"><b>Бренд:</b> {item.brandSnapshot}</p>
        )}
        {item.compositionSnapshot && (
          <p className="stash-card-row"><b>Состав:</b> {item.compositionSnapshot}</p>
        )}
        {item.mPer100gSnapshot != null && (
          <p className="stash-card-row"><b>Метраж:</b> {item.mPer100gSnapshot}м/100г</p>
        )}
        <p className="stash-card-row stash-card-remainder">
          <b>Остаток:</b> {item.currentWeightG} г из {item.totalWeightG} г
        </p>
      </div>
    </SwipeToDelete>
  );
};
