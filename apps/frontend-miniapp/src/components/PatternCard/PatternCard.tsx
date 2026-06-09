import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart } from 'lucide-react';
import './PatternCard.css';

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

  const handleCardClick = () => {
    navigate(`/pattern/${id}`);
  };

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // чтобы не сработал переход при клике на лайк
    console.log('Toggle favorite');
  };

  return (
    <div className="pattern-card" onClick={handleCardClick}>
      <div className="pattern-card-image-container">
        <img src={imageUrl} alt={title} className="pattern-card-image" />
        {isFree && <span className="badge-free">Бесплатно</span>}
        <button className="favorite-button" onClick={handleFavoriteClick} aria-label="Add to favorites">
          <Heart size={32} strokeWidth={1} />
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
