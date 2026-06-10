import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Heart, SlidersHorizontal } from 'lucide-react';
import { PatternCard } from '../../components/PatternCard/PatternCard';
import { fetchPatterns, Pattern, FetchPatternsOptions } from '../../api/patternsApi';
import './Catalog.css';

type FilterType = 'all' | 'free' | 'new' | 'popular';

export const Catalog: React.FC = () => {
  const navigate = useNavigate();
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');

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

  // Reset pagination when filters or search change
  useEffect(() => {
    setOffset(0);
    setHasMore(true);
    setPatterns([]);
  }, [debouncedSearch, activeFilter]);

  useEffect(() => {
    let isMounted = true;
    const loadPatterns = async () => {
      // Only set main loading true if it's initial load
      if (offset === 0) setLoading(true);
      setError(null);
      try {
        const options: FetchPatternsOptions = {
          search: debouncedSearch || undefined,
          isFree: activeFilter === 'free' ? true : undefined,
          isNew: activeFilter === 'new' ? true : undefined,
          limit: LIMIT,
          offset: offset,
        };

        const data = await fetchPatterns(options);
        if (isMounted) {
          if (offset === 0) {
            setPatterns(data);
          } else {
            setPatterns(prev => {
              const newItems = data.filter(newItem => !prev.some(existing => existing.id === newItem.id));
              return [...prev, ...newItems];
            });
          }
          setHasMore(data.length === LIMIT);
        }
      } catch (err) {
        console.error(err);
        if (isMounted) setError("Не удалось загрузить каталог");
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadPatterns();

    return () => {
      isMounted = false;
    };
  }, [debouncedSearch, activeFilter, offset]);

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
        <button className="filter-settings-btn" aria-label="Настройки фильтров">
          <SlidersHorizontal size={24} />
        </button>
        <div className="filter-separator" />
        <div className="catalog-filters">
          <button
            className={`filter-btn ${activeFilter === 'free' ? 'active' : ''}`}
            onClick={() => setActiveFilter(activeFilter === 'free' ? 'all' : 'free')}
          >
            Бесплатные
          </button>
          <button
            className={`filter-btn ${activeFilter === 'new' ? 'active' : ''}`}
            onClick={() => setActiveFilter(activeFilter === 'new' ? 'all' : 'new')}
          >
            Новинки
          </button>
          <button
            className={`filter-btn ${activeFilter === 'popular' ? 'active' : ''}`}
            onClick={() => setActiveFilter(activeFilter === 'popular' ? 'all' : 'popular')}
          >
            Популярное
          </button>
        </div>
      </div>

      {loading && <p>Загрузка каталога...</p>}
      {error && <p style={{ color: 'red', marginTop: '16px' }}>{error}</p>}

      {!loading && !error && patterns.length === 0 && (
        <p style={{ marginTop: '24px', textAlign: 'center', color: '#6b7280' }}>
          Ничего не найдено
        </p>
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
            <div className="load-more-container">
              <button
                className="load-more-link"
                onClick={() => setOffset(prev => prev + LIMIT)}
              >
                Загрузить еще
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
