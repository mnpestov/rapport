import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { useFavorites } from '../../context/FavoritesContext';
import './PatternCard.css';
// DIAG: remove after investigation
import { diagLog } from '../../lib/diagnosticLogger';

interface PatternCardProps {
  id: string;
  title: string;
  primaryProductType?: string;
  instruments?: string[];
  imageUrl: string;
  isFree: boolean;
}

export const PatternCard: React.FC<PatternCardProps> = ({ id, title, primaryProductType, instruments, imageUrl, isFree }) => {
  const navigate = useNavigate();
  const { isFavorite, toggleFavorite } = useFavorites();

  const favorite = isFavorite(id);

  const handleCardClick = () => {
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
          onLoad={() =>
            // DIAG
            diagLog('IMAGE_LOAD_SUCCESS', 'Card image loaded', { imageUrl, patternId: id })
          }
          onError={() =>
            // DIAG
            diagLog('IMAGE_LOAD_ERROR', 'Card image failed to load', { imageUrl, patternId: id })
          }
        />
        {isFree && <span className="badge-free">Бесплатно</span>}
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
