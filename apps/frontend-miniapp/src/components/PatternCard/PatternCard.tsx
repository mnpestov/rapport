import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { useFavorites } from '../../context/FavoritesContext';
import './PatternCard.css';

interface PatternCardProps {
  id: string;
  title: string;
  primaryProductType?: string;
  instruments?: string[];
  imageUrl: string;
  isFree: boolean;
  isNew?: boolean;
  // Fired before navigation, e.g. so the caller can log a search-query
  // click-through while it still knows the active search context.
  onBeforeNavigate?: () => void;
}

export const PatternCard: React.FC<PatternCardProps> = ({ id, title, primaryProductType, instruments, imageUrl, isFree, isNew, onBeforeNavigate }) => {
  const navigate = useNavigate();
  const { isFavorite, toggleFavorite } = useFavorites();

  const favorite = isFavorite(id);

  const handleCardClick = () => {
    onBeforeNavigate?.();
    sessionStorage.setItem('catalog_scroll', window.scrollY.toString());
    navigate(`/pattern/${id}`);
  };

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // чтобы не сработал переход при клике на лайк
    toggleFavorite(id);
  };

  return (
    <div className="pattern-card" onClick={handleCardClick}>
      <div className="pattern-card-image-container">
        <img
          src={imageUrl}
          alt={title}
          className="pattern-card-image"
        />
        {(isNew || isFree) && (
          <div className="badge-stack">
            {isNew && <span className="badge-new">Новинка</span>}
            {isFree && <span className="badge-free">Бесплатно</span>}
          </div>
        )}
        <button className="favorite-button" onClick={handleFavoriteClick} aria-label={favorite ? "Remove from favorites" : "Add to favorites"}>
          <Heart size={32} strokeWidth={1} fill={favorite ? "white" : "none"} color={favorite ? "white" : "currentColor"} />
        </button>
      </div>
      <div className="pattern-card-content">
        <h3 className="pattern-title">{title}</h3>
        <div className="pattern-tags-row">
          <div className="pattern-tag">
            <span className="product-type">{primaryProductType || 'Описание'}</span>
          </div>
          {instruments && instruments.length > 0 && (
            <div className="pattern-tag">
              <span className="pattern-instrument">{instruments.join(', ')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
