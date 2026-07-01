import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFavorites } from '../../context/FavoritesContext';
import { fetchPatternsByIds, Pattern } from '../../api/patternsApi';
import { PatternCard } from '../../components/PatternCard/PatternCard';
import arrowLeftIcon from '../../assets/arrow-left.svg';
import './Favorites.css';

const LIMIT = 20;

export const Favorites: React.FC = () => {
  const navigate = useNavigate();
  const { favorites } = useFavorites();
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const hasMore = offset < favorites.length;

  // Initial load and reset when favorites list changes
  useEffect(() => {
    let isMounted = true;

    const loadInitial = async () => {
      if (favorites.length === 0) {
        if (isMounted) { setPatterns([]); setLoading(false); }
        return;
      }

      setLoading(true);
      try {
        const slice = favorites.slice(0, LIMIT);
        const results = await fetchPatternsByIds(slice);
        if (isMounted) {
          setPatterns(results);
          setOffset(LIMIT);
        }
      } catch (err) {
        console.error("Failed to load favorites", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    setOffset(0);
    setPatterns([]);
    loadInitial();

    return () => { isMounted = false; };
  }, [favorites]);

  const loadMore = useCallback(async () => {
    if (isFetchingMore || offset >= favorites.length) return;

    setIsFetchingMore(true);
    try {
      const slice = favorites.slice(offset, offset + LIMIT);
      const results = await fetchPatternsByIds(slice);
      setPatterns(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        return [...prev, ...results.filter(p => !existingIds.has(p.id))];
      });
      setOffset(prev => prev + LIMIT);
    } catch (err) {
      console.error("Failed to load more favorites", err);
    } finally {
      setIsFetchingMore(false);
    }
  }, [isFetchingMore, offset, favorites]);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (loading || isFetchingMore) return;
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        loadMore();
      }
    });

    if (node) observerRef.current.observe(node);
  }, [loading, isFetchingMore, hasMore, loadMore]);

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
        {!loading && favorites.length > 0 && (
          <div className="favorites-subtitle">
            найдено описаний: {favorites.length}
          </div>
        )}
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

      {!loading && patterns.length > 0 && (
        <>
          <div className="catalog-grid">
            {patterns.map(pattern => (
              <PatternCard key={pattern.id} {...pattern} />
            ))}
          </div>
          {hasMore && (
            <div ref={sentinelRef} style={{ height: '20px' }}>
              {isFetchingMore && <p className="loading-message" style={{ marginTop: 0 }}>Загрузка...</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
};
