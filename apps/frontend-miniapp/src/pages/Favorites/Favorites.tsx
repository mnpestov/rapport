import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFavorites } from '../../context/FavoritesContext';
import { fetchPatternsByIds, fetchFilters, Pattern, FiltersResponse } from '../../api/patternsApi';
import { PatternCard } from '../../components/PatternCard/PatternCard';
import { SearchFilterBar } from '../../components/SearchFilterBar/SearchFilterBar';
import { FilterModal, SelectedFilters } from '../../components/FilterModal/FilterModal';
import { SortModal, SortOption } from '../../components/SortModal/SortModal';
import { Footer } from '../../components/Footer/Footer';
import { filterPatterns, sortPatterns, computeFacetsFromPatterns } from '../../utils/clientPatternFilters';
import { usePremiumAccess } from '../../hooks/usePremiumAccess';
import arrowLeftIcon from '../../assets/arrow-left.svg';
import './Favorites.css';

const PAGE_SIZE = 20;

const EMPTY_FILTERS: SelectedFilters = {
  categories: [], tags: [], instruments: [], authors: [], yarnRanges: [], density: [], priceMin: '', priceMax: ''
};

export const Favorites: React.FC = () => {
  const navigate = useNavigate();
  const { favorites } = useFavorites();

  // The whole favorited set, loaded once (chunked, see fetchPatternsByIds)
  // whenever `favorites` gains ids — search/filter/pagination below all
  // operate on this in-memory array, no further network calls. Favorites
  // lists are bounded/user-curated (largest seen on prod: 522), unlike the
  // catalog's own server-paginated model — see the plan discussion this was
  // built from.
  const [allPatterns, setAllPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);

  // Reference-only: id→label + sortOrder for yarnRanges, since Pattern only
  // carries yarnRangeIds (no parallel label array) — fetched once, never
  // recomputed from favorites. Not used as the option SOURCE (that's still
  // computeFacetsFromPatterns over allPatterns), only for display names and
  // display order. Empty until loaded — fine, yarnRanges section is
  // PREMIUM_CORE-gated in FilterModal anyway, and simply renders no options
  // for non-core users regardless.
  const [yarnRangesUniverse, setYarnRangesUniverse] = useState<FiltersResponse['yarnRanges']>([]);

  const { extra } = usePremiumAccess();

  const [searchInput, setSearchInput] = useState(() => sessionStorage.getItem('favorites_search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(searchInput);
  const [isFreeFilterActive, setIsFreeFilterActive] = useState(() => sessionStorage.getItem('favorites_free_filter') === 'true');
  const [isNewFilterActive, setIsNewFilterActive] = useState(() => sessionStorage.getItem('favorites_new_filter') === 'true');
  const [isDiscountFilterActive, setIsDiscountFilterActive] = useState(() => sessionStorage.getItem('favorites_discount_filter') === 'true');
  const [sortValue, setSortValue] = useState<SortOption>(() => (sessionStorage.getItem('favorites_sort') as SortOption) || 'newest');
  const [advancedFilters, setAdvancedFilters] = useState<SelectedFilters>(() => {
    const saved = sessionStorage.getItem('favorites_advanced_filters');
    if (saved) {
      try { return { ...EMPTY_FILTERS, ...JSON.parse(saved) }; } catch { }
    }
    return EMPTY_FILTERS;
  });
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [isSortModalOpen, setIsSortModalOpen] = useState(false);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    sessionStorage.setItem('favorites_search', searchInput);
    sessionStorage.setItem('favorites_free_filter', String(isFreeFilterActive));
    sessionStorage.setItem('favorites_new_filter', String(isNewFilterActive));
    sessionStorage.setItem('favorites_discount_filter', String(isDiscountFilterActive));
    sessionStorage.setItem('favorites_sort', sortValue);
    sessionStorage.setItem('favorites_advanced_filters', JSON.stringify(advancedFilters));
  }, [searchInput, isFreeFilterActive, isNewFilterActive, isDiscountFilterActive, sortValue, advancedFilters]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    fetchFilters().then(data => setYarnRangesUniverse(data.yarnRanges)).catch(console.error);
  }, []);

  const prevFavoritesRef = useRef<string[]>([]);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    const prev = prevFavoritesRef.current;
    prevFavoritesRef.current = favorites;

    // Pure removal: all current favorites were already in the previous
    // list, nothing added — just filter the already-loaded patterns down,
    // no need to refetch anything we already have in memory. Gated on
    // hasLoadedRef — without it, StrictMode's dev-mode double-invoke (mount
    // → cleanup → mount again, same `favorites` both times whenever the
    // favorites context had already resolved before this page mounted)
    // makes the SECOND invocation see prev === favorites and wrongly take
    // this branch on the very first real mount, before anything was ever
    // loaded — which never calls setLoading(false), leaving the page stuck
    // on "Загрузка..." forever. Only trust "just a removal" once a load has
    // actually completed.
    const isOnlyRemovals = hasLoadedRef.current && prev.length > 0 && favorites.every(id => prev.includes(id));
    if (isOnlyRemovals) {
      const keepIds = new Set(favorites);
      setAllPatterns(curr => curr.filter(p => keepIds.has(p.id)));
      return;
    }

    let isMounted = true;

    const load = async () => {
      if (favorites.length === 0) {
        if (isMounted) { setAllPatterns([]); setLoading(false); hasLoadedRef.current = true; }
        return;
      }
      setLoading(true);
      try {
        const results = await fetchPatternsByIds(favorites);
        if (isMounted) { setAllPatterns(results); hasLoadedRef.current = true; }
      } catch (err) {
        console.error("Failed to load favorites", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    load();
    return () => { isMounted = false; };
  }, [favorites]);

  // Фильтры и сортировка в Избранном — платные (кнопки скрыты без
  // PREMIUM_EXTRA, см. SearchFilterBar). Здесь дополнительно НЕ применяем
  // сохранённый выбор, если права больше нет: значения лежат в
  // sessionStorage и переживают истечение подписки, а кнопки к тому моменту
  // уже скрыты — человек остался бы с отфильтрованным списком без всякой
  // возможности это увидеть и сбросить.
  const effectiveFilters = extra ? advancedFilters : EMPTY_FILTERS;
  const effectiveSort: SortOption = extra ? sortValue : 'newest';

  const filteredPatterns = useMemo(() => sortPatterns(filterPatterns(allPatterns, {
    search: debouncedSearch,
    isFree: isFreeFilterActive,
    isNew: isNewFilterActive,
    isDiscount: isDiscountFilterActive,
    selected: effectiveFilters,
  }), effectiveSort), [allPatterns, debouncedSearch, isFreeFilterActive, isNewFilterActive, isDiscountFilterActive, effectiveSort, effectiveFilters]);

  // Reset client-side pagination whenever the effective filter changes —
  // same trigger set Catalog resets its (server-side) offset on.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    setVisibleCount(PAGE_SIZE);
  }, [debouncedSearch, isFreeFilterActive, isNewFilterActive, isDiscountFilterActive, sortValue, advancedFilters]);

  const visiblePatterns = filteredPatterns.slice(0, visibleCount);
  const hasMore = visibleCount < filteredPatterns.length;

  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (loading) return;
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        setVisibleCount(prev => prev + PAGE_SIZE);
      }
    });

    if (node) observerRef.current.observe(node);
  }, [loading, hasMore]);

  // Favorites' own unfiltered option universe (only values that actually
  // occur among favorited patterns — deliberately NOT the whole catalog's
  // options, unlike Catalog's filtersData) — recomputed only when the
  // loaded set or the yarnRanges name reference changes, not on every
  // keystroke/selection change.
  const filtersData = useMemo(
    () => computeFacetsFromPatterns(allPatterns, EMPTY_FILTERS, yarnRangesUniverse),
    [allPatterns, yarnRangesUniverse]
  );

  // Stable reference (useCallback) — FilterModal's own facet-refetch effect
  // depends on this function identity; an inline arrow here would trigger
  // an extra recompute on every unrelated Favorites re-render.
  const fetchFacets = useCallback(
    (selected: SelectedFilters) => Promise.resolve(computeFacetsFromPatterns(allPatterns, selected, yarnRangesUniverse)),
    [allPatterns, yarnRangesUniverse]
  );

  const totalFiltersCount = advancedFilters.categories.length +
    advancedFilters.tags.length +
    advancedFilters.instruments.length +
    advancedFilters.authors.length +
    advancedFilters.yarnRanges.length +
    advancedFilters.density.length +
    (advancedFilters.priceMin || advancedFilters.priceMax ? 1 : 0);

  const clearFilters = (e: React.MouseEvent) => {
    e.stopPropagation();
    setAdvancedFilters(EMPTY_FILTERS);
  };

  const hasActiveQuery = isFreeFilterActive || isNewFilterActive || isDiscountFilterActive || totalFiltersCount > 0 || debouncedSearch.trim() !== '';

  return (
    <div className="favorites-container">
      <div className="favorites-header">
        <button className="back-button" onClick={() => navigate(-1)}>
          <img src={arrowLeftIcon} alt="Back" className="back-button-icon" />
          Назад
        </button>
      </div>

      <div className="favorites-title-container">
        <h1 className="favorites-title">Избранное</h1>
      </div>

      {loading && <p className="loading-message">Загрузка...</p>}

      {!loading && favorites.length === 0 && (
        <div className="favorites-empty">
          <h2>У вас пока нет избранных описаний</h2>
          <p>Нажимайте на сердечко у понравившихся описаний в каталоге, чтобы сохранить их здесь.</p>
          <button className="favorites-empty-btn" onClick={() => navigate('/')}>
            В каталог
          </button>
        </div>
      )}

      {!loading && favorites.length > 0 && (
        <>
          <SearchFilterBar
            searchInput={searchInput}
            onSearchChange={setSearchInput}
            isFreeActive={isFreeFilterActive}
            onToggleFree={() => setIsFreeFilterActive(v => !v)}
            isNewActive={isNewFilterActive}
            onToggleNew={() => setIsNewFilterActive(v => !v)}
            isDiscountActive={isDiscountFilterActive}
            onToggleDiscount={() => setIsDiscountFilterActive(v => !v)}
            onOpenSortModal={() => setIsSortModalOpen(true)}
            totalFiltersCount={totalFiltersCount}
            onOpenFilterModal={() => setIsFilterModalOpen(true)}
            onClearFilters={clearFilters}
            foundCount={filteredPatterns.length}
            hasActiveQuery={hasActiveQuery}
            filtersRequireExtra
          />

          {filteredPatterns.length === 0 && (
            <div className="catalog-empty-state">
              По вашему запросу ничего не найдено. <br />
              Попробуйте изменить запрос или воспользоваться фильтрами.
            </div>
          )}

          {filteredPatterns.length > 0 && (
            <>
              <div className="catalog-grid">
                {visiblePatterns.map(pattern => (
                  <PatternCard key={pattern.id} {...pattern} />
                ))}
              </div>
              {hasMore && (
                <div ref={sentinelRef} style={{ height: '20px' }} />
              )}
              {/* Same reasoning as Catalog.tsx — only once this client-side
                  page of the already-loaded set is fully exhausted. */}
              {!hasMore && <Footer />}
            </>
          )}
        </>
      )}

      <FilterModal
        isOpen={isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        initialFilters={advancedFilters}
        filtersData={filtersData}
        loading={false}
        onApply={setAdvancedFilters}
        fetchFacets={fetchFacets}
      />

      <SortModal
        isOpen={isSortModalOpen}
        onClose={() => setIsSortModalOpen(false)}
        value={sortValue}
        onApply={setSortValue}
      />
    </div>
  );
};
