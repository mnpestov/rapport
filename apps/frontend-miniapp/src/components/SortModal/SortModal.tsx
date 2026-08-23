import React, { useState, useEffect } from 'react';
import { CustomRadioChecked, CustomRadioUnchecked } from '../Icons/Icons';
import { usePremiumAccess } from '../../hooks/usePremiumAccess';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import '../../styles/sheet.css';
import './SortModal.css';

export type SortOption = 'newest' | 'popular' | 'price_asc' | 'price_desc';

const DEFAULT_SORT: SortOption = 'newest';

interface SortModalProps {
  isOpen: boolean;
  onClose: () => void;
  value: SortOption;
  onApply: (value: SortOption) => void;
}

// Price-based options need real price data to mean anything — same gate as
// the "Скидка" chip/filter: hidden entirely for non-PREMIUM_EXTRA, not
// shown disabled.
//
// Бесплатному пользователю шторка открывается (кнопка сортировки показана
// всем, см. SearchFilterBar) и он видит в ней два варианта — «Последние
// добавленные» и «Популярные». Фильтр ниже — единственное, что не пускает
// к ним ценовые.
const OPTIONS: { value: SortOption; label: string; extraOnly?: boolean }[] = [
  { value: 'newest', label: 'Последние добавленные' },
  // Не extraOnly: популярность считается по добавлениям в избранное, платных
  // полей в ответе для неё не нужно — в отличие от цены.
  { value: 'popular', label: 'Популярные' },
  { value: 'price_asc', label: 'Дешевле', extraOnly: true },
  { value: 'price_desc', label: 'Дороже', extraOnly: true },
];

export const SortModal: React.FC<SortModalProps> = ({ isOpen, onClose, value, onApply }) => {
  // Держит шторку в дереве на время выезда вниз и даёт класс для
  // открытого состояния — сам по себе `isOpen` размонтировал бы её
  // мгновенно, до анимации закрытия.
  const { isMounted, isVisible, sheetRef } = useSheetTransition(isOpen);
  const { extra } = usePremiumAccess();
  const [selected, setSelected] = useState<SortOption>(value);

  useEffect(() => {
    if (isOpen) setSelected(value);
  }, [isOpen, value]);

  if (!isMounted) return null;

  const options = OPTIONS.filter(o => !o.extraOnly || extra);

  const handleReset = () => setSelected(DEFAULT_SORT);
  const handleApply = () => {
    onApply(selected);
    onClose();
  };

  return (
    <div ref={sheetRef} className={`sort-modal-overlay sheet-overlay ${isVisible ? 'sheet-open' : ''}`} onClick={onClose}>
      <div className="sort-modal-content sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sort-modal-grabber" />
        <h2 className="sort-modal-title">Показать сначала</h2>

        <div className="sort-modal-options">
          {options.map(opt => (
            <div
              key={opt.value}
              className="sort-radio-label"
              onClick={() => setSelected(opt.value)}
            >
              <div className="sort-radio-custom">
                {selected === opt.value ? <CustomRadioChecked size={24} /> : <CustomRadioUnchecked size={24} />}
              </div>
              <span className="sort-radio-text">{opt.label}</span>
            </div>
          ))}
        </div>

        <div className="sort-modal-footer">
          <button className="sort-reset-btn" onClick={handleReset}>Сбросить все</button>
          <button className="sort-apply-btn" onClick={handleApply}>Применить</button>
        </div>
      </div>
    </div>
  );
};
