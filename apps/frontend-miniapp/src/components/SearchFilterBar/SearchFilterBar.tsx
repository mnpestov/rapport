import React from 'react';
import { Search, X, Heart, SlidersHorizontal, ArrowDownUp } from 'lucide-react';
import { CustomX } from '../Icons/Icons';
import { usePremiumAccess } from '../../hooks/usePremiumAccess';
import { SubscriptionButton } from '../SubscriptionButton/SubscriptionButton';
import { submitPaywallEvent } from '../../api/paywallApi';
import './SearchFilterBar.css';

interface SearchFilterBarProps {
  searchInput: string;
  onSearchChange: (value: string) => void;
  // Catalog-only "jump to favorites" shortcut — omitted on the favorites
  // page itself (you're already there). Both props required together.
  showFavoritesButton?: boolean;
  onFavoritesClick?: () => void;
  isFreeActive: boolean;
  onToggleFree: () => void;
  isNewActive: boolean;
  onToggleNew: () => void;
  // Chip itself is hidden entirely without PREMIUM_EXTRA (checked here via
  // usePremiumAccess, not left to callers) — price/oldPrice aren't even
  // returned to non-extra users, so a "Скидка" toggle would just filter
  // against data the caller could never show or explain. Callers still
  // always pass these two props; gating is purely a render decision here.
  isDiscountActive: boolean;
  onToggleDiscount: () => void;
  // Opens the sort bottom sheet — the sort VALUE itself lives with the
  // caller (Catalog/Favorites), same division of ownership as
  // totalFiltersCount/onOpenFilterModal below.
  //
  // Кнопка скрыта без PREMIUM_EXTRA (гейт здесь, как и у чипа "Скидка").
  // Раньше она показывалась всем, а гейтились только два ценовых варианта
  // внутри шторки — но тогда у бесплатного пользователя оставался ровно
  // один вариант, "Последние добавленные", он же выбранный по умолчанию.
  // Кнопка, открывающая выбор из одного уже выбранного пункта, бесполезна.
  onOpenSortModal: () => void;
  totalFiltersCount: number;
  onOpenFilterModal: () => void;
  onClearFilters: (e: React.MouseEvent) => void;
  // Total items in the current view.
  foundCount: number;
  // "найдено"/"всего описаний" switch — passed explicitly rather than
  // derived from `searchInput` here, because Catalog decides this off its
  // *debounced* search value (matching when `foundCount` itself actually
  // updates), not the raw keystroke — computing it from `searchInput`
  // directly would flip the label a beat before the count it's describing
  // catches up.
  hasActiveQuery: boolean;
  // Избранное: ВЕСЬ инструментарий поиска и фильтрации там — платная
  // функция (в баннере это "Фильтры в Избранном"), поэтому без
  // PREMIUM_EXTRA скрывается строка поиска, быстрые чипы и обе кнопки —
  // остаётся только кнопка подписки и счётчик.
  //
  // В каталоге поиск и фильтры бесплатны (платные — плотность и толщина
  // пряжи, они гейтятся внутри шторки фильтров), поэтому там проп не
  // передаётся. Флаг про поведение, а не про страницу: гейт задаёт тот,
  // кто знает, платная ли фича в его контексте.
  toolbarRequiresExtra?: boolean;
  // Кнопка вызова шторки подписки. В Избранном не нужна — там она только
  // мешает, а открыть шторку можно из каталога, куда с этой страницы и так
  // есть переход. По умолчанию показывается (каталог проп не передаёт).
  showSubscriptionButton?: boolean;
}

// Identical search+filter header used on Catalog and Favorites — see
// FAVORITES_SEARCH_FILTERS_PLAN discussion: the two pages have fundamentally
// different data-fetching models (server-paginated vs. client-side over an
// already-loaded list), but the header itself has no reason to differ, so
// it's extracted here rather than copy-pasted to avoid the two drifting
// apart on a future Catalog-only tweak.
export const SearchFilterBar: React.FC<SearchFilterBarProps> = ({
  searchInput,
  onSearchChange,
  showFavoritesButton,
  onFavoritesClick,
  isFreeActive,
  onToggleFree,
  isNewActive,
  onToggleNew,
  isDiscountActive,
  onToggleDiscount,
  onOpenSortModal,
  totalFiltersCount,
  onOpenFilterModal,
  onClearFilters,
  foundCount,
  hasActiveQuery,
  toolbarRequiresExtra = false,
  showSubscriptionButton = true,
}) => {
  const { extra, paywallUiEnabled } = usePremiumAccess();
  // Один выключатель на всю панель: строку поиска, чипы и обе кнопки.
  const toolbarLocked = toolbarRequiresExtra && !extra;
  // Кнопка сортировки доступна всем: платные в шторке только ценовые
  // варианты, а «Последние добавленные» и «Популярные» — нет. Раньше её
  // прятали от бесплатных потому, что кроме ценовых там ничего и не было и
  // выбирать было не из чего; с появлением популярности это перестало быть
  // правдой. В Избранном на неё по-прежнему распространяется toolbarLocked
  // ниже — там скрыта вся панель целиком, это отдельное решение.
  const showSortButton = !toolbarLocked;
  const showFilterButton = !toolbarLocked;
  // Что осталось бы в ряду поиска, если саму строку скрыли.
  const hasSearchRowContent = (showSubscriptionButton && paywallUiEnabled) || !!showFavoritesButton;

  return (
    <>
      {/* Без единого элемента ряд поиска — просто вертикальный отступ
          ниоткуда, поэтому не рендерим его вовсе. Так бывает в Избранном у
          бесплатного пользователя: поиск скрыт, кнопки подписки нет, а
          "сердечко" туда и не передаётся. */}
      {(!toolbarLocked || hasSearchRowContent) && (
      <div className="search-row">
        {!toolbarLocked && (
        <div className="search-input-wrapper">
          <Search size={20} className="search-icon" />
          <input
            type="text"
            placeholder="Найти описание"
            className="search-input"
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          {/* Always rendered (not conditional) — its box stays in the flex
              row's layout at all times, so .search-input (flex:1) doesn't
              gain/lose width when this shows up as text is typed. Hidden via
              visibility, which still reserves space, unlike display:none. */}
          <button
            className="search-clear-btn"
            onClick={() => onSearchChange('')}
            aria-label="Clear search"
            style={{ visibility: searchInput ? 'visible' : 'hidden' }}
            tabIndex={searchInput ? 0 : -1}
          >
            <X size={24} className="clear-icon" />
          </button>
        </div>
        )}
        {/* Ручной вызов шторки подписки (Figma 1073:5550 / 997:4769).
            Открывает её через window-событие, а не проп: сама шторка живёт
            в App.tsx, а этот компонент рендерится внутри Catalog/Favorites
            — прокидывать колбэк пришлось бы через обе страницы. Тот же
            приём, что уже используется для auth:ready/auth:recheck. */}
        {showSubscriptionButton && paywallUiEnabled && (
          <SubscriptionButton
            isActive={extra}
            onClick={() => {
              submitPaywallEvent('BUTTON_OPENED', 'SEARCH_BUTTON');
              window.dispatchEvent(new CustomEvent('paywall:open'));
            }}
          />
        )}
        {showFavoritesButton && (
          <button className="search-favorite-btn" onClick={onFavoritesClick} aria-label="Favorites">
            <Heart size={24} color="#D8540F" fill="#D8540F" />
          </button>
        )}
      </div>
      )}

      {!toolbarLocked && (
      <div className="filters-row">
        {showFilterButton && (
          <button
            className={`filter-settings-btn ${totalFiltersCount > 0 ? 'has-filters' : ''}`}
            aria-label="Настройки фильтров"
            onClick={onOpenFilterModal}
          >
            <SlidersHorizontal size={24} />
            {totalFiltersCount > 0 && (
              <>
                <span className="filter-count">({totalFiltersCount})</span>
                <div className="filter-clear-icon" onClick={onClearFilters}>
                  <CustomX size={24} />
                </div>
              </>
            )}
          </button>
        )}
        {/* Разделитель имеет смысл только между двумя кнопками — иначе
            повисает у края ряда. */}
        {showFilterButton && showSortButton && <div className="filter-separator" />}
        {showSortButton && (
          <button
            className="sort-settings-btn"
            aria-label="Сортировка"
            onClick={onOpenSortModal}
          >
            <ArrowDownUp size={24} />
          </button>
        )}
        <div className="catalog-filters">
          {extra && (
            <button
              className={`filter-btn ${isDiscountActive ? 'active' : ''}`}
              onClick={onToggleDiscount}
            >
              Скидка
            </button>
          )}
          <button
            className={`filter-btn ${isNewActive ? 'active' : ''}`}
            onClick={onToggleNew}
          >
            Новинки
          </button>
          <button
            className={`filter-btn ${isFreeActive ? 'active' : ''}`}
            onClick={onToggleFree}
          >
            Бесплатные
          </button>
        </div>
      </div>
      )}

      <div className="catalog-found-count">
        {hasActiveQuery ? 'найдено описаний:' : 'всего описаний:'}{' '}
        {foundCount}
      </div>
    </>
  );
};
