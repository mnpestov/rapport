import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { CustomRadioChecked, CustomRadioUnchecked } from '../Icons/Icons'; // используются в мобильной шторке
import { usePremiumAccess } from '../../hooks/usePremiumAccess';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import '../../styles/sheet.css';
import './SortModal.css';

export type SortOption = 'newest' | 'popular' | 'price_asc' | 'price_desc';

const DEFAULT_SORT: SortOption = 'newest';

interface SortModalProps {
  isOpen: boolean;
  onClose: () => void;
  value: SortOption;
  onApply: (value: SortOption) => void;
  // Кнопка сортировки в SearchFilterBar. На десктопе окно раскрывается как
  // выпадающий селект под этой кнопкой, а не как нижняя шторка. На мобиле
  // не используется — там шторка занимает низ экрана целиком.
  anchorRef?: React.RefObject<HTMLElement | null>;
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

export const SortModal: React.FC<SortModalProps> = ({ isOpen, onClose, value, onApply, anchorRef }) => {
  const isDesktop = useIsDesktop();
  const { extra } = usePremiumAccess();

  // Платные (ценовые) варианты скрыты у бесплатного пользователя в ОБОИХ
  // раскладках — и в шторке, и в десктопном селекте.
  const options = OPTIONS.filter(o => !o.extraOnly || extra);

  if (isDesktop) {
    return (
      <SortDropdown
        isOpen={isOpen}
        onClose={onClose}
        value={value}
        onApply={onApply}
        anchorRef={anchorRef}
        options={options}
      />
    );
  }

  return (
    <SortSheet isOpen={isOpen} onClose={onClose} value={value} onApply={onApply} options={options} />
  );
};

// --- Мобильная нижняя шторка (прежнее поведение без изменений) -----------

interface SortViewProps {
  isOpen: boolean;
  onClose: () => void;
  value: SortOption;
  onApply: (value: SortOption) => void;
  options: { value: SortOption; label: string }[];
}

const SortSheet: React.FC<SortViewProps> = ({ isOpen, onClose, value, onApply, options }) => {
  // Держит шторку в дереве на время выезда вниз и даёт класс для
  // открытого состояния — сам по себе `isOpen` размонтировал бы её
  // мгновенно, до анимации закрытия.
  const { isMounted, isVisible, sheetRef } = useSheetTransition(isOpen);
  const [selected, setSelected] = useState<SortOption>(value);

  useEffect(() => {
    if (isOpen) setSelected(value);
  }, [isOpen, value]);

  if (!isMounted) return null;

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

// --- Десктопный выпадающий селект --------------------------------------

interface SortDropdownProps extends SortViewProps {
  anchorRef?: React.RefObject<HTMLElement | null>;
}

const SortDropdown: React.FC<SortDropdownProps> = ({ isOpen, onClose, value, onApply, anchorRef, options }) => {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Позиционируем панель под кнопкой до первой отрисовки, чтобы не было
  // мигания из левого верхнего угла.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const anchor = anchorRef?.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left });
  }, [isOpen, anchorRef]);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return; // повторный клик по кнопке закроет через её собственный обработчик
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Скролл/ресайз сдвигают кнопку — проще закрыть, чем гнать пересчёт.
    const onReflow = () => onClose();

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [isOpen, onClose, anchorRef]);

  if (!isOpen || !pos) return null;

  // Селект: выбор применяется сразу и закрывает список — без «Применить».
  const handlePick = (opt: SortOption) => {
    onApply(opt);
    onClose();
  };

  return (
    <div
      ref={dropdownRef}
      className="sort-dropdown"
      style={{ top: pos.top, left: pos.left }}
      role="listbox"
      aria-label="Показать сначала"
    >
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          role="option"
          aria-selected={value === opt.value}
          className={`sort-dropdown-option${value === opt.value ? ' sort-dropdown-option--selected' : ''}`}
          onClick={() => handlePick(opt.value)}
        >
          <span className="sort-dropdown-option-text">{opt.label}</span>
        </button>
      ))}
    </div>
  );
};
