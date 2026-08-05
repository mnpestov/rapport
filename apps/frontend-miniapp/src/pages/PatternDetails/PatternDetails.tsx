import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { fetchPatternById, Pattern } from '../../api/patternsApi';
import { trackPatternView, trackPatternLinkClick } from '../../api/analyticsApi';
import { useFavorites } from '../../context/FavoritesContext';
import arrowLeftIcon from '../../assets/arrow-left.svg';
import './PatternDetails.css';

// Density comes from the backend as a Decimal-serialized string (e.g. "20.00")
// — strip the trailing zeros for display ("20.00" -> "20", "25.50" -> "25.5").
const formatDecimal = (value: string): string => {
  const num = parseFloat(value);
  return Number.isNaN(num) ? value : num.toString();
};

// Swipeable gallery — plain CSS scroll-snap, no carousel library. Single
// image falls back to a static <img> (no track/dots overhead).
const ImageCarousel: React.FC<{ images: string[]; alt: string }> = ({ images, alt }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  if (images.length <= 1) {
    return <img src={images[0]} alt={alt} className="details-image" />;
  }

  const handleScroll = () => {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    setActiveIndex(Math.round(track.scrollLeft / track.clientWidth));
  };

  const scrollToIndex = (index: number) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: index * track.clientWidth, behavior: 'smooth' });
  };

  return (
    <>
      <div className="details-image-track" ref={trackRef} onScroll={handleScroll}>
        {images.map((src, index) => (
          <img key={index} src={src} alt={`${alt} ${index + 1}`} className="details-image-slide" />
        ))}
      </div>
      <div className="details-image-dots">
        {images.map((_, index) => (
          <button
            key={index}
            type="button"
            className={`details-image-dot${index === activeIndex ? ' details-image-dot--active' : ''}`}
            onClick={() => scrollToIndex(index)}
            aria-label={`Фото ${index + 1}`}
          />
        ))}
      </div>
    </>
  );
};

export const PatternDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { isFavorite, toggleFavorite } = useFavorites();

  const [pattern, setPattern] = useState<Pattern | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (!id) return;

    const loadPattern = async () => {
      try {
        const data = await fetchPatternById(id);
        if (isMounted) {
          setPattern(data);
          trackPatternView(id);
        }
      } catch (err) {
        console.error(err);
        if (isMounted) setError("Описание не найдено");
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadPattern();

    return () => {
      isMounted = false;
    };
  }, [id]);

  const handleBack = () => {
    if (location.key !== 'default') {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  const handleOpenLink = () => {
    if (!pattern?.externalLink) return;

    if (id) {
      trackPatternLinkClick(id);
    }

    const tg = (window as any).Telegram?.WebApp;
    if (tg?.openLink) {
      tg.openLink(pattern.externalLink);
    } else {
      window.open(pattern.externalLink, '_blank');
    }
  };

  if (loading) {
    return (
      <div className="details-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p>Загрузка описания...</p>
      </div>
    );
  }

  if (error || !pattern) {
    return (
      <div className="details-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <h2>Описание не найдено</h2>
        <button className="back-button" onClick={handleBack} style={{ marginTop: '16px' }}>
          <img src={arrowLeftIcon} alt="Back" className="back-button-icon" />
          Вернуться в каталог
        </button>
      </div>
    );
  }

  return (
    <div className="details-container">
      <div className="details-header">
        <button className="back-button" onClick={handleBack}>
          <img src={arrowLeftIcon} alt="Back" className="back-button-icon" />
          Назад
        </button>
      </div>

      <div className="details-body">
        <div className="details-image-wrapper">
          <div className="details-image-container">
            <ImageCarousel images={pattern.images && pattern.images.length > 0 ? pattern.images : [pattern.imageUrl]} alt={pattern.title} />
            <button
              className="favorite-button"
              onClick={() => id && toggleFavorite(id)}
              aria-label={id && isFavorite(id) ? "Remove from favorites" : "Add to favorites"}
            >
              <Heart size={32} strokeWidth={1} fill={id && isFavorite(id) ? "white" : "none"} color={id && isFavorite(id) ? "white" : "currentColor"} />
            </button>
            {pattern.isFree && <span className="badge-free badge-free--details">Бесплатно</span>}
          </div>
        </div>

        <div className="details-right">
          <div className="details-content">
            <div className="details-row">
              <span className="details-product-type">{pattern.primaryProductType}</span>
            </div>
            <div className="details-row">
              <h1 className="details-title">{pattern.title}</h1>
            </div>

            <div className="details-row-spaced">
              <span className="details-label">Инструмент:</span>
              <span className="details-value">{pattern.instruments.join(', ')}</span>
            </div>

            <div className="details-row-spaced">
              <span className="details-label">Автор:</span>
              <span className="details-value">{pattern.author}</span>
            </div>

            {pattern.tags && pattern.tags.length > 0 && (
              <div className="details-col">
                <span className="details-label">Характеристики:</span>
                <ul className="details-value-list">
                  {pattern.tags.map((tag, index) => (
                    <li key={index}>{tag}</li>
                  ))}
                </ul>
              </div>
            )}

            {pattern.yarnRanges && pattern.yarnRanges.length > 0 && (
              <div className="details-col">
                <span className="details-label">Толщина пряжи <span className="details-label-unit">(м/100 г):</span></span>
                <ul className="details-value-list">
                  {pattern.yarnRanges.map((range, index) => (
                    <li key={index}>{range}</li>
                  ))}
                </ul>
              </div>
            )}

            {pattern.densityStitches != null && pattern.densityRows != null && (
              <div className="details-row-spaced">
                <span className="details-label">Плотность <span className="details-label-unit">(лицевая гладь):</span></span>
                <span className="details-value details-value-nowrap">
                  {formatDecimal(pattern.densityStitches)} п. × {formatDecimal(pattern.densityRows)} р.
                </span>
              </div>
            )}
          </div>

          <div className="details-footer">
            <button
              className="btn btn--primary details-cta"
              onClick={handleOpenLink}
            >
              Перейти к описанию
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
