import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFavorites } from '../../context/FavoritesContext';
import { fetchPatternById, Pattern } from '../../api/patternsApi';
import { PatternCard } from '../../components/PatternCard/PatternCard';
import './Favorites.css';

export const Favorites: React.FC = () => {
  const navigate = useNavigate();
  const { favorites } = useFavorites();
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    
    const loadFavorites = async () => {
      if (favorites.length === 0) {
        if (isMounted) {
          setPatterns([]);
          setLoading(false);
        }
        return;
      }
      
      setLoading(true);
      try {
        const results = await Promise.all(
          favorites.map(id => fetchPatternById(id).catch(e => {
            console.error(`Failed to fetch pattern ${id}`, e);
            return null;
          }))
        );
        const validPatterns = results.filter((p): p is Pattern => p !== null);
        if (isMounted) setPatterns(validPatterns);
      } catch (err) {
        console.error("Failed to load favorites", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadFavorites();

    return () => {
      isMounted = false;
    };
  }, [favorites]);

  return (
    <div className="favorites-container">
      <div className="favorites-header">
        <button className="back-button" onClick={() => navigate(-1)}>← Назад</button>
      </div>

      <div className="favorites-title-container">
        <h1 className="favorites-title">Избранное</h1>
        {!loading && favorites.length > 0 && (
          <div className="favorites-subtitle">
            найдено описаний: {favorites.length}
          </div>
        )}
      </div>

      {loading && <p className="favorites-message">Загрузка...</p>}

      {!loading && favorites.length === 0 && (
        <div className="favorites-empty">
          <h2>У вас пока нет избранных описаний</h2>
          <p>Нажимайте на сердечко у понравившихся описаний в каталоге, чтобы сохранить их здесь.</p>
          <button className="btn btn--primary" onClick={() => navigate('/')} style={{ marginTop: '24px' }}>
            В каталог
          </button>
        </div>
      )}

      {!loading && favorites.length > 0 && patterns.length > 0 && (
        <div className="catalog-grid">
          {patterns.map(pattern => (
            <PatternCard key={pattern.id} {...pattern} />
          ))}
        </div>
      )}
    </div>
  );
};
