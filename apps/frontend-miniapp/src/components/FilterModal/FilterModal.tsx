import React, { useState, useEffect } from 'react';
import { X, Search, Lock } from 'lucide-react';
import { CustomSquareUncheck, CustomSquareCheck, CustomChevronDown } from '../Icons/Icons';
import { fetchFilters, FiltersResponse, FilterOption } from '../../api/patternsApi';
import { submitPaywallEvent } from '../../api/paywallApi';
import { usePremiumAccess } from '../../hooks/usePremiumAccess';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import '../../styles/sheet.css';
import './FilterModal.css';

interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (selectedFilters: SelectedFilters) => void;
  initialFilters: SelectedFilters;
}

export interface SelectedFilters {
  categories: string[];
  tags: string[];
  instruments: string[];
  authors: string[];
  yarnRanges: string[];
  density: string[];
  // Not a facet like the six above (no discrete option list to pick from —
  // it's a continuous range), so it deliberately isn't a key of
  // FiltersResponse and doesn't go through renderSection/handleToggle.
  // '' means unset, matching how the two inputs themselves are controlled.
  priceMin: string;
  priceMax: string;
}

interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (selectedFilters: SelectedFilters) => void;
  initialFilters: SelectedFilters;
  filtersData: FiltersResponse | null;
  loading: boolean;
  // How to re-fetch each section's narrowed option list as the draft
  // selection changes. Defaults to the real network fetchFilters (catalog,
  // faceted against the whole DB). Favorites passes a synchronous
  // client-side computation over its already-loaded pattern list instead —
  // see clientPatternFilters.ts's computeFacetsFromPatterns — wrapped in a
  // resolved Promise so this component's debounce/abort plumbing doesn't
  // need to know which case it's in.
  fetchFacets?: (selected: SelectedFilters, signal: AbortSignal) => Promise<FiltersResponse>;
}

const defaultFetchFacets = (selected: SelectedFilters, signal: AbortSignal) =>
  fetchFilters({ ...selected, signal });

export const FilterModal: React.FC<FilterModalProps> = ({ isOpen, onClose, onApply, initialFilters, filtersData, loading, fetchFacets = defaultFetchFacets }) => {
  // Держит шторку в дереве на время выезда вниз и даёт класс для
  // открытого состояния — сам по себе `isOpen` размонтировал бы её
  // мгновенно, до анимации закрытия.
  const { isMounted, isVisible, sheetRef } = useSheetTransition(isOpen);
  // Density/yarn-thickness sections require PREMIUM_CORE, price requires
  // PREMIUM_EXTRA — renderSection always renders its header regardless of
  // whether options is empty, so gating has to happen at the call site, not
  // inside it. See PAID_TIER_PERMISSIONS_PLAN.md §3.4.
  //
  // Без доступа секция больше не исчезает, а показывается замком
  // (renderLockedSection): бесплатный пользователь видит полный список
  // фильтров и понимает, что именно даёт подписка — иначе о платных
  // фильтрах неоткуда узнать. Сам доступ этим не ослаблен: раскрыть такую
  // секцию нельзя, значений в `selected` не появляется, а бэкенд и так
  // игнорирует платные параметры без разрешения (§3.4).
  //
  // `paywallUiEnabled` — тот же единственный выключатель всех платных
  // поверхностей, что у баннера и кнопки подписки (authController.ts): до
  // публичного запуска обычный пользователь платного UI не видит вовсе, и
  // замки для него — четвёртая такая поверхность, а не исключение.
  const { core, extra, paywallUiEnabled } = usePremiumAccess();
  const [selected, setSelected] = useState<SelectedFilters>(initialFilters);
  const [isPriceExpanded, setIsPriceExpanded] = useState(false);
  // Live, narrowed option lists — recomputed server-side (see the effect
  // below) as `selected` changes, so e.g. picking a category prunes density
  // options down to what actually occurs on patterns in that category.
  // `filtersData` (the unfiltered universe, fetched once by Catalog) is used
  // as the seed/fallback and as the name lookup for "stale" options below.
  const [facetData, setFacetData] = useState<FiltersResponse | null>(filtersData);
  const [expandedSections, setExpandedSections] = useState<Array<keyof FiltersResponse>>([]);
  const [filterSearches, setFilterSearches] = useState<Record<keyof FiltersResponse, string>>({
    categories: '',
    tags: '',
    instruments: '',
    authors: '',
    yarnRanges: '',
    density: '' // unused — density has its own two-input search below, kept only to satisfy the Record type
  });
  // Density's search is two independent numeric fields ("п." / "р."), unlike
  // every other section's single free-text box — needs its own state shape.
  const [densitySearch, setDensitySearch] = useState({ stitches: '', rows: '' });

  useEffect(() => {
    if (isOpen) {
      setSelected(initialFilters);
    }
  }, [isOpen, initialFilters]);

  // Debounced faceted refetch: whenever the draft selection changes while the
  // modal is open, ask the backend for option lists narrowed to everything
  // *except* each section's own picks (self-exclusion happens server-side).
  // Skipped (cheap, no network) when nothing is selected — that's exactly
  // the unfiltered `filtersData` Catalog already fetched once.
  useEffect(() => {
    if (!isOpen) return;

    const isEmpty = selected.categories.length === 0 && selected.tags.length === 0 &&
      selected.instruments.length === 0 && selected.authors.length === 0 &&
      selected.yarnRanges.length === 0 && selected.density.length === 0;

    if (isEmpty) {
      setFacetData(filtersData);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchFacets(selected, controller.signal)
        .then(setFacetData)
        .catch(err => {
          if (err instanceof Error && err.name === 'AbortError') return;
          console.error(err);
        });
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [selected, isOpen, filtersData, fetchFacets]);

  if (!isMounted) return null;

  const handleToggle = (section: keyof FiltersResponse, id: string) => {
    setSelected(prev => {
      const currentList = prev[section];
      if (currentList.includes(id)) {
        return { ...prev, [section]: currentList.filter(item => item !== id) };
      } else {
        return { ...prev, [section]: [...currentList, id] };
      }
    });
  };

  const handleReset = () => {
    setSelected({ categories: [], tags: [], instruments: [], authors: [], yarnRanges: [], density: [], priceMin: '', priceMax: '' });
    setDensitySearch({ stitches: '', rows: '' });
  };

  const handleApply = () => {
    onApply(selected);
    onClose();
  };

  // Шторка подписки живёт в App.tsx — отсюда она открывается window-событием,
  // тем же приёмом, что и кнопка подписки в строке поиска (SearchFilterBar).
  // Шторку фильтров при этом НЕ закрываем: баннер перекрывает её сверху, и
  // после закрытия человек возвращается к своему незавершённому набору
  // фильтров, а не начинает заново.
  const handleLockedClick = () => {
    submitPaywallEvent('BUTTON_OPENED', 'FILTER_LOCK');
    window.dispatchEvent(new CustomEvent('paywall:open', { detail: { source: 'FILTER_LOCK' } }));
  };

  // Платная секция без доступа: тот же заголовок на своём месте, но
  // приглушённый, с замком вместо стрелки и без тела. Не <button disabled> —
  // тап по ней должен работать, он и есть точка входа в оплату; для
  // скринридера состояние передаёт aria-disabled.
  const renderLockedSection = (title: string) => (
    <div className="filter-section">
      <button
        className="filter-section-header filter-section-header--locked"
        onClick={handleLockedClick}
        aria-disabled="true"
      >
        <span className="filter-section-title">{title}</span>
        {/* Тот же бокс 32×32, что у стрелки (её svg именно такого размера) —
            иначе платные строки оказались бы ниже остальных. */}
        <span className="filter-section-lock">
          <Lock size={20} />
        </span>
      </button>
    </div>
  );

  // Bespoke, not routed through renderSection — price is a continuous range,
  // not a facet with a discrete option list (handleToggle/staleIds/
  // facetData narrowing don't apply). Gated on `extra`, not `core` like
  // yarnRanges/density below — price/oldPrice are PREMIUM_EXTRA-only
  // (patternVisibility.ts's PATTERN_PRICE_OMIT), a completely independent
  // permission from PREMIUM_CORE. Same visual chrome (filter-section-header
  // with the chevron) as every other section, for consistency.
  const renderPriceSection = () => (
    <div className="filter-section">
      <button
        className="filter-section-header"
        onClick={() => setIsPriceExpanded(v => !v)}
      >
        <span className="filter-section-title">Цена</span>
        {/* Одна и та же стрелка вниз, повёрнутая на 180° в раскрытом
            состоянии — так поворот анимируется (подмена двух разных иконок
            была бы мгновенной). */}
        <span className={`filter-section-chevron${isPriceExpanded ? ' filter-section-chevron--expanded' : ''}`}>
          <CustomChevronDown size={32} />
        </span>
      </button>
      {isPriceExpanded && (
        <div className="filter-section-body">
          <div className="filter-density-search-row">
            <input
              type="number"
              inputMode="numeric"
              placeholder="от"
              className="filter-search-input filter-density-input"
              value={selected.priceMin}
              onChange={(e) => setSelected(prev => ({ ...prev, priceMin: e.target.value }))}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="filter-density-search-label">—</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="до"
              className="filter-search-input filter-density-input"
              value={selected.priceMax}
              onChange={(e) => setSelected(prev => ({ ...prev, priceMax: e.target.value }))}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="filter-density-search-label">р.</span>
            {/* Same reasoning as density's clear button — always rendered,
                visibility-toggled, so the two flex:1 inputs above don't
                shrink/grow (14px each, measured live) when this appears. */}
            <button
              className="filter-search-clear"
              onClick={(e) => { e.stopPropagation(); setSelected(prev => ({ ...prev, priceMin: '', priceMax: '' })); }}
              style={{ visibility: (selected.priceMin || selected.priceMax) ? 'visible' : 'hidden' }}
              tabIndex={(selected.priceMin || selected.priceMax) ? 0 : -1}
            >
              <X size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const renderSection = (title: string, sectionKey: keyof FiltersResponse) => {
    const isExpanded = expandedSections.includes(sectionKey);
    // `facetData` is the live, narrowed list (falls back to the unfiltered
    // `filtersData` until the first facet response arrives). An already-
    // checked value that fell out of the narrowed list is merged back in
    // (looked up by id in the unfiltered universe) and flagged as "stale" —
    // it stays visible/checked so the user can see and deselect it, instead
    // of silently vanishing or silently being unchecked.
    const activeData = facetData || filtersData;
    const hasData = activeData && activeData[sectionKey];
    let options = hasData ? [...activeData[sectionKey]] : [];

    const staleIds = new Set<string>();
    const liveIds = new Set(options.map(o => o.id));
    const universalOptions = filtersData?.[sectionKey] || [];
    for (const id of selected[sectionKey]) {
      if (!liveIds.has(id)) {
        const found = universalOptions.find(o => o.id === id);
        if (found) {
          options.push(found);
          staleIds.add(id);
        }
      }
    }

    // Alphabetical sort — except yarnRanges (fixed bucket order via backend
    // sortOrder) and density (backend already returns it numerically sorted
    // by stitches then rows; alphabetical would scatter "20 п. × 32 р." vs
    // "9 п. × 12 р." lexicographically instead of numerically).
    if (sectionKey !== 'yarnRanges' && sectionKey !== 'density') {
      options.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    }

    // Apply search — density uses two independent numeric prefix matches
    // (stitches, rows) against its "stitchesxrows" id instead of the shared
    // single free-text search everyone else uses.
    if (sectionKey === 'density') {
      const stitchesQuery = densitySearch.stitches.trim();
      const rowsQuery = densitySearch.rows.trim();
      if (stitchesQuery || rowsQuery) {
        options = options.filter(o => {
          const [idStitches, idRows] = o.id.split('x');
          const matchesStitches = !stitchesQuery || idStitches.startsWith(stitchesQuery);
          const matchesRows = !rowsQuery || idRows.startsWith(rowsQuery);
          return matchesStitches && matchesRows;
        });
      }
    } else {
      const q = filterSearches[sectionKey]?.trim().toLowerCase();
      if (q) {
        options = options.filter(o => o.name.toLowerCase().includes(q));
      }
    }

    return (
      <div className="filter-section">
        <button
          className="filter-section-header"
          onClick={() => setExpandedSections(prev =>
            prev.includes(sectionKey) ? prev.filter(k => k !== sectionKey) : [...prev, sectionKey]
          )}
        >
          <span className="filter-section-title">{title}</span>
          <span className={`filter-section-chevron${isExpanded ? ' filter-section-chevron--expanded' : ''}`}>
            <CustomChevronDown size={32} />
          </span>
        </button>
        {isExpanded && (
          <div className="filter-section-body">
            {sectionKey === 'density' ? (
              <div className="filter-density-search-row">
                <input
                  type="number"
                  inputMode="numeric"
                  // placeholder="20"
                  className="filter-search-input filter-density-input"
                  value={densitySearch.stitches}
                  onChange={(e) => setDensitySearch(prev => ({ ...prev, stitches: e.target.value }))}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="filter-density-search-label">п. ×</span>
                <input
                  type="number"
                  inputMode="numeric"
                  // placeholder="32"
                  className="filter-search-input filter-density-input"
                  value={densitySearch.rows}
                  onChange={(e) => setDensitySearch(prev => ({ ...prev, rows: e.target.value }))}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="filter-density-search-label">р.</span>
                {/* Always rendered — reserves its space in the flex row at
                    all times so the two flex:1 inputs don't lose/regain
                    width (split evenly between them) as this shows up. */}
                <button
                  className="filter-search-clear"
                  onClick={(e) => { e.stopPropagation(); setDensitySearch({ stitches: '', rows: '' }); }}
                  style={{ visibility: (densitySearch.stitches || densitySearch.rows) ? 'visible' : 'hidden' }}
                  tabIndex={(densitySearch.stitches || densitySearch.rows) ? 0 : -1}
                >
                  <X size={20} />
                </button>
              </div>
            ) : sectionKey !== 'instruments' && sectionKey !== 'yarnRanges' && (
              <div className="filter-search-input-wrapper filter-search-inline">
                <Search size={20} className="filter-search-icon" />
                <input
                  type="text"
                  placeholder="Поиск..."
                  className="filter-search-input"
                  value={filterSearches[sectionKey]}
                  onChange={(e) => setFilterSearches(prev => ({ ...prev, [sectionKey]: e.target.value }))}
                  onClick={(e) => e.stopPropagation()}
                />
                {/* Same reasoning as density's clear button above. */}
                <button
                  className="filter-search-clear"
                  onClick={(e) => { e.stopPropagation(); setFilterSearches(prev => ({ ...prev, [sectionKey]: '' })); }}
                  style={{ visibility: filterSearches[sectionKey] ? 'visible' : 'hidden' }}
                  tabIndex={filterSearches[sectionKey] ? 0 : -1}
                >
                  <X size={20} />
                </button>
              </div>
            )}
            {loading && <p className="filter-loading">Загрузка...</p>}
            {!loading && options.length === 0 && <p className="filter-empty">Ничего не найдено</p>}
            {!loading && options.map((opt: FilterOption) => {
              const isChecked = selected[sectionKey].includes(opt.id);
              const isStale = staleIds.has(opt.id);
              return (
                <div
                  key={opt.id}
                  className={`filter-checkbox-label${isStale ? ' filter-checkbox-label--stale' : ''}`}
                  onClick={() => handleToggle(sectionKey, opt.id)}
                >
                  <div className="filter-checkbox-custom">
                    {isChecked ? <CustomSquareCheck size={32} /> : <CustomSquareUncheck size={32} />}
                  </div>
                  <span className="filter-checkbox-text">{opt.name}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={sheetRef} className={`filter-modal-overlay sheet-overlay ${isVisible ? 'sheet-open' : ''}`}>
      <div className="filter-modal-content sheet-panel">
        <div className="filter-modal-header">
          <button className="filter-close-btn" onClick={onClose}>
            <X size={24} />
          </button>
          <h2 className="filter-modal-title">Фильтр</h2>
          <div style={{ width: 24 }}></div> {/* Spacer for centering */}
        </div>

        <div className="filter-modal-body">
          {(extra || paywallUiEnabled) && (
            <>
              {extra ? renderPriceSection() : renderLockedSection('Цена')}
              <div className="filter-divider" />
            </>
          )}
          {renderSection("Тип изделия", "categories")}
          <div className="filter-divider" />
          {renderSection("Характеристики", "tags")}
          <div className="filter-divider" />
          {renderSection("Инструмент", "instruments")}
          <div className="filter-divider" />
          {renderSection("Автор", "authors")}
          {(core || paywallUiEnabled) && (
            <>
              <div className="filter-divider" />
              {core
                ? renderSection("Толщина пряжи (м/100г)", "yarnRanges")
                : renderLockedSection("Толщина пряжи (м/100г)")}
              <div className="filter-divider" />
              {core ? renderSection("Плотность", "density") : renderLockedSection("Плотность")}
            </>
          )}
        </div>

        <div className="filter-modal-footer">
          <button className="filter-reset-btn" onClick={handleReset}>Сбросить все</button>
          <button
            className="filter-apply-btn"
            onClick={handleApply}
            disabled={selected.categories.length === 0 && selected.tags.length === 0 && selected.instruments.length === 0 && selected.authors.length === 0 && selected.yarnRanges.length === 0 && selected.density.length === 0 && !selected.priceMin && !selected.priceMax}
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
};
