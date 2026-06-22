import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Heart, SlidersHorizontal } from 'lucide-react';
import { PatternCard } from '../../components/PatternCard/PatternCard';
import { fetchPatterns, Pattern, FetchPatternsOptions, fetchFilters, FiltersResponse } from '../../api/patternsApi';
import { FilterModal, SelectedFilters } from '../../components/FilterModal/FilterModal';
import { CustomX } from '../../components/Icons/Icons';
import './Catalog.css';
// DIAG: remove after investigation
import { diagLog } from '../../lib/diagnosticLogger';

type FilterType = 'all' | 'free' | 'new' | 'popular';

export const Catalog: React.FC = () => {
  const navigate = useNavigate();
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [totalPatterns, setTotalPatterns] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState(() => sessionStorage.getItem('catalog_search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(searchInput);
  const [isFreeFilterActive, setIsFreeFilterActive] = useState(() => sessionStorage.getItem('catalog_free_filter') === 'true');

  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [filtersData, setFiltersData] = useState<FiltersResponse | null>(null);
  
  const [advancedFilters, setAdvancedFilters] = useState<SelectedFilters>(() => {
    const saved = sessionStorage.getItem('catalog_advanced_filters');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return {
      categories: [],
      tags: [],
      instruments: [],
      authors: []
    };
  });

  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const LIMIT = 10;

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Save to sessionStorage
  useEffect(() => {
    sessionStorage.setItem('catalog_search', searchInput);
    sessionStorage.setItem('catalog_free_filter', String(isFreeFilterActive));
    sessionStorage.setItem('catalog_advanced_filters', JSON.stringify(advancedFilters));
  }, [searchInput, isFreeFilterActive, advancedFilters]);

  useEffect(() => {
    fetchFilters().then(setFiltersData).catch(console.error);
  }, []);

  // Reset pagination when filters or search change
  useEffect(() => {
    setOffset(0);
    setHasMore(true);
    setPatterns([]);
  }, [debouncedSearch, isFreeFilterActive, advancedFilters]);

  useEffect(() => {
    let isMounted = true;
    const loadPatterns = async () => {
      if (offset === 0) setLoading(true);
      else setIsFetchingMore(true);
      
      setError(null);
      try {
        const options: FetchPatternsOptions = {
          search: debouncedSearch || undefined,
          isFree: isFreeFilterActive ? true : undefined,
          limit: LIMIT,
          offset: offset,
          categories: advancedFilters.categories.length > 0 ? advancedFilters.categories : undefined,
          tags: advancedFilters.tags.length > 0 ? advancedFilters.tags : undefined,
          instruments: advancedFilters.instruments.length > 0 ? advancedFilters.instruments : undefined,
          authors: advancedFilters.authors.length > 0 ? advancedFilters.authors : undefined,
        };

        const { data, total } = await fetchPatterns(options);
        if (isMounted) {
          setTotalPatterns(total);
          if (offset === 0) {
            setPatterns(data);
          } else {
            setPatterns(prev => {
              const newItems = data.filter(newItem => !prev.some(existing => existing.id === newItem.id));
              return [...prev, ...newItems];
            });
          }
          setHasMore(data.length === LIMIT);
          // DIAG
          diagLog('CATALOG_LOADED', 'Catalog page loaded', {
            count: data.length,
            total,
            offset,
            hasMore: data.length === LIMIT,
          });
        }
      } catch (err) {
        // DIAG: guard against stale requests (user navigated away before fetch completed)
        if (isMounted) {
          diagLog('CATALOG_LOAD_ERROR', err instanceof Error ? err.message : String(err));
        }
        console.error(err);
        if (isMounted) setError("Не удалось загрузить каталог");
      } finally {
        if (isMounted) {
          setLoading(false);
          setIsFetchingMore(false);
        }
      }
    };

    loadPatterns();

    return () => {
      isMounted = false;
    };
  }, [debouncedSearch, isFreeFilterActive, offset, advancedFilters]);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const lastElementRef = useCallback((node: HTMLDivElement | null) => {
    if (loading || isFetchingMore) return;
    if (observerRef.current) observerRef.current.disconnect();
    
    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        setOffset(prev => prev + LIMIT);
      }
    });
    
    if (node) observerRef.current.observe(node);
  }, [loading, isFetchingMore, hasMore]);

  const totalFiltersCount = advancedFilters.categories.length +
    advancedFilters.tags.length +
    advancedFilters.instruments.length +
    advancedFilters.authors.length;

  const clearFilters = (e: React.MouseEvent) => {
    e.stopPropagation();
    setAdvancedFilters({ categories: [], tags: [], instruments: [], authors: [] });
  };

  return (
    <div className="catalog-container">
      <div className="search-row">
        <div className="search-input-wrapper">
          <Search size={20} className="search-icon" />
          <input
            type="text"
            placeholder="Найти описание"
            className="search-input"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchInput && (
            <button className="search-clear-btn" onClick={() => setSearchInput('')} aria-label="Clear search">
              <X size={24} className="clear-icon" />
            </button>
          )}
        </div>
        <button className="search-favorite-btn" onClick={() => navigate('/favorites')} aria-label="Favorites">
          <Heart size={24} color="#D8540F" fill="#D8540F" />
        </button>
      </div>

      <div className="filters-row">
        <button
          className={`filter-settings-btn ${totalFiltersCount > 0 ? 'has-filters' : ''}`}
          aria-label="Настройки фильтров"
          onClick={() => setIsFilterModalOpen(true)}
        >
          <SlidersHorizontal size={24} />
          {totalFiltersCount > 0 && (
            <>
              <span className="filter-count">({totalFiltersCount})</span>
              <div className="filter-clear-icon" onClick={clearFilters}>
                <CustomX size={24} />
              </div>
            </>
          )}
        </button>
        <div className="filter-separator" />
        <div className="catalog-filters">
          <button
            className={`filter-btn ${isFreeFilterActive ? 'active' : ''}`}
            onClick={() => setIsFreeFilterActive(!isFreeFilterActive)}
          >
            Бесплатные
          </button>
        </div>
      </div>

      {(isFreeFilterActive || totalFiltersCount > 0 || debouncedSearch.trim() !== '') && (
        <div className="catalog-found-count">
          найдено описаний: {totalPatterns}
        </div>
      )}

      {loading && <p className="loading-message">Загрузка каталога...</p>}
      {error && <p style={{ color: 'red', marginTop: '16px' }}>{error}</p>}

      {!loading && !error && patterns.length === 0 && (
        <div className="catalog-empty-state">
          По вашему запросу ничего не найдено. <br />
          Попробуйте изменить запрос или воспользоваться фильтрами.
        </div>
      )}

      {!loading && !error && patterns.length > 0 && (
        <>
          <div className="catalog-grid">
            {patterns.map(pattern => (
              <PatternCard
                key={pattern.id}
                {...pattern}
              />
            ))}
          </div>
          {hasMore && (
            <div ref={lastElementRef} className="load-more-container" style={{ height: '20px' }}>
              {isFetchingMore && <p className="loading-message" style={{ marginTop: 0 }}>Загрузка...</p>}
            </div>
          )}
        </>
      )}

      <FilterModal
        isOpen={isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        initialFilters={advancedFilters}
        filtersData={filtersData}
        loading={!filtersData}
        onApply={(selected) => setAdvancedFilters(selected)}
      />
    </div>
  );
};
