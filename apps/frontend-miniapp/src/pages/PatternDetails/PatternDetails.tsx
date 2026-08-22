import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { fetchPatternById, fetchSimilarPatterns, Pattern } from '../../api/patternsApi';
import { trackPatternView, trackPatternLinkClick } from '../../api/analyticsApi';
import { useFavorites } from '../../context/FavoritesContext';
import { usePremiumAccess } from '../../hooks/usePremiumAccess';
import { CustomChevronDown, CustomChevronUp } from '../../components/Icons/Icons';
import { PatternCard } from '../../components/PatternCard/PatternCard';
import { ImageWithRetry } from '../../components/ImageWithRetry/ImageWithRetry';
import { canGoBackInApp } from '../../hooks/useNavigationDepth';
import { hasVisiblePrice, hasActiveDiscount } from '../../utils/priceHelpers';
import { openExternalLink } from '../../utils/telegram';
import { Footer } from '../../components/Footer/Footer';
import arrowLeftIcon from '../../assets/arrow-left.svg';
import './PatternDetails.css';

// Density comes from the backend as a Decimal-serialized string (e.g. "20.00")
// — strip the trailing zeros for display ("20.00" -> "20", "25.50" -> "25.5").
const formatDecimal = (value: string): string => {
  const num = parseFloat(value);
  return Number.isNaN(num) ? value : num.toString();
};

// Swipeable gallery — plain CSS scroll-snap, no carousel library. Single
// image renders on its own (no track/dots overhead).
const ImageCarousel: React.FC<{ images: string[]; alt: string }> = ({ images, alt }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  if (images.length <= 1) {
    return <ImageWithRetry src={images[0]} alt={alt} className="details-image" />;
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
          <ImageWithRetry
            key={index}
            src={src}
            alt={`${alt} ${index + 1}`}
            className="details-image-slide"
            // 70% of patterns carry 5 full-size photos (~1.1 MB together) and
            // every slide used to start at once, competing with the one the
            // reader actually looks at. Only the visible slide and its
            // neighbour load up front; the rest wait until swiped near.
            loading={index <= 1 ? 'eager' : 'lazy'}
            decoding="async"
          />
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
  const { isFavorite, toggleFavorite } = useFavorites();
  // authorId/author name are already public regardless of access level
  // (unlike price/details/similar, which the backend itself omits) — this
  // is the one place that needs an explicit frontend gate, and it must
  // check PREMIUM_EXTRA specifically, not isAdmin — a non-admin explicitly
  // granted the flag must see this too. See PAID_TIER_PERMISSIONS_PLAN.md §3.4.
  const { extra } = usePremiumAccess();

  const [pattern, setPattern] = useState<Pattern | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);
  const [similarPatterns, setSimilarPatterns] = useState<Pattern[]>([]);

  useEffect(() => {
    let isMounted = true;
    if (!id) return;

    // Unlike every other way this page was reachable before, a click inside
    // "Похожие описания" navigates /pattern/:id -> /pattern/:otherId on the
    // SAME route — React Router doesn't remount the component for that, so
    // none of this state (or scroll position) resets itself the way it
    // would on a fresh mount. Reset explicitly, otherwise the old pattern's
    // content/scroll/expanded state briefly (or on error, permanently)
    // leaks into the new one.
    window.scrollTo(0, 0);
    setPattern(null);
    setLoading(true);
    setError(null);
    setIsDetailsExpanded(false);
    setSimilarPatterns([]);

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

  useEffect(() => {
    let isMounted = true;
    if (!id) return;

    fetchSimilarPatterns(id)
      .then(data => {
        if (isMounted) setSimilarPatterns(data);
      })
      .catch(err => console.error(err));

    return () => {
      isMounted = false;
    };
  }, [id]);

  const handleBack = () => {
    // Не location.key: он живёт в history.state и переживает перезагрузку
    // документа, поэтому после того, как WebView поднял приложение заново
    // прямо на карточке (возврат с сайта автора), он врал, что позади есть
    // страница, и navigate(-1) уходил за пределы приложения.
    if (canGoBackInApp()) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  const handleAuthorClick = () => {
    if (!pattern?.authorId) return;
    navigate('/', { state: { filterAuthorId: pattern.authorId } });
  };

  const handleOpenLink = () => {
    if (!pattern?.externalLink) return;

    if (id) {
      trackPatternLinkClick(id);
    }

    openExternalLink(pattern.externalLink);
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
            {hasActiveDiscount(pattern) && <span className="badge-discount badge-discount--details">Скидка</span>}
          </div>
        </div>

        <div className="details-right">
          <div className="details-content">
            <div className="details-row">
              <span className="details-product-type">{pattern.primaryProductType}</span>
              {hasVisiblePrice(pattern) && (
                <div className="details-price-row">
                  <span className="details-price-current">{formatDecimal(pattern.price as string)} ₽</span>
                  {hasActiveDiscount(pattern) && (
                    <span className="details-price-old">{formatDecimal(pattern.oldPrice as string)} ₽</span>
                  )}
                </div>
              )}
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
              {pattern.authorId && extra ? (
                <button type="button" className="details-value details-author-link" onClick={handleAuthorClick}>
                  {pattern.author}
                </button>
              ) : (
                <span className="details-value">{pattern.author}</span>
              )}
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

            {pattern.details && (
              <div className="details-col details-expandable">
                <button
                  type="button"
                  className="details-expandable-header"
                  onClick={() => setIsDetailsExpanded(v => !v)}
                  aria-expanded={isDetailsExpanded}
                >
                  <span className="details-label">Подробности</span>
                  {isDetailsExpanded ? <CustomChevronUp size={24} /> : <CustomChevronDown size={24} />}
                </button>
                {isDetailsExpanded && (
                  <p className="details-expandable-body">{pattern.details}</p>
                )}
              </div>
            )}

            {similarPatterns.length > 0 && (
              <div className="details-col">
                <span className="details-similar-title">Похожие описания</span>
                <div className="details-similar-row">
                  {similarPatterns.map(similar => (
                    <div className="details-similar-item" key={similar.id}>
                      <PatternCard {...similar} preserveCatalogScroll={false} />
                    </div>
                  ))}
                </div>
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

      {/* Full-width, below both columns — distinct from .details-footer
          above (that's just the CTA button's own wrapper, pre-existing,
          not this page-wide component). Only page where sourceUrl is ever
          passed — the "Источник информации" line. */}
      <Footer sourceUrl={pattern.authorSite} />
    </div>
  );
};
