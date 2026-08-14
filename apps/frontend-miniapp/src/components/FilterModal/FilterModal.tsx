import React, { useState, useEffect } from 'react';
import { X, Search } from 'lucide-react';
import { CustomSquareUncheck, CustomSquareCheck, CustomChevronDown, CustomChevronUp } from '../Icons/Icons';
import { fetchFilters, FiltersResponse, FilterOption } from '../../api/patternsApi';
import { usePremiumAccess } from '../../hooks/usePremiumAccess';
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
  // Density/yarn-thickness sections require PREMIUM_CORE — renderSection
  // always renders its header regardless of whether options is empty, so
  // gating has to happen at the call site, not inside it. See
  // PAID_TIER_PERMISSIONS_PLAN.md §3.4.
  const { core } = usePremiumAccess();
  const [selected, setSelected] = useState<SelectedFilters>(initialFilters);
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

  if (!isOpen) return null;

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
    setSelected({ categories: [], tags: [], instruments: [], authors: [], yarnRanges: [], density: [] });
    setDensitySearch({ stitches: '', rows: '' });
  };

  const handleApply = () => {
    onApply(selected);
    onClose();
  };

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
          {isExpanded ? <CustomChevronDown size={32} /> : <CustomChevronUp size={32} />}
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
                {(densitySearch.stitches || densitySearch.rows) && (
                  <button
                    className="filter-search-clear"
                    onClick={(e) => { e.stopPropagation(); setDensitySearch({ stitches: '', rows: '' }); }}
                  >
                    <X size={20} />
                  </button>
                )}
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
                {filterSearches[sectionKey] && (
                  <button
                    className="filter-search-clear"
                    onClick={(e) => { e.stopPropagation(); setFilterSearches(prev => ({ ...prev, [sectionKey]: '' })); }}
                  >
                    <X size={20} />
                  </button>
                )}
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
    <div className="filter-modal-overlay">
      <div className="filter-modal-content">
        <div className="filter-modal-header">
          <button className="filter-close-btn" onClick={onClose}>
            <X size={24} />
          </button>
          <h2 className="filter-modal-title">Фильтр</h2>
          <div style={{ width: 24 }}></div> {/* Spacer for centering */}
        </div>

        <div className="filter-modal-body">
          {renderSection("Тип изделия", "categories")}
          <div className="filter-divider" />
          {renderSection("Характеристики", "tags")}
          <div className="filter-divider" />
          {renderSection("Инструмент", "instruments")}
          <div className="filter-divider" />
          {renderSection("Автор", "authors")}
          {core && (
            <>
              <div className="filter-divider" />
              {renderSection("Толщина пряжи (м/100г)", "yarnRanges")}
              <div className="filter-divider" />
              {renderSection("Плотность", "density")}
            </>
          )}
        </div>

        <div className="filter-modal-footer">
          <button className="filter-reset-btn" onClick={handleReset}>Сбросить все</button>
          <button
            className="filter-apply-btn"
            onClick={handleApply}
            disabled={selected.categories.length === 0 && selected.tags.length === 0 && selected.instruments.length === 0 && selected.authors.length === 0 && selected.yarnRanges.length === 0 && selected.density.length === 0}
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
};
