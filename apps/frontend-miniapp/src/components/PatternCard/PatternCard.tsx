import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { useFavorites } from '../../context/FavoritesContext';
import './PatternCard.css';

// Price comes from the backend as a Decimal-serialized string (e.g. "590.00")
// — strip trailing zeros for display, same convention as PatternDetails'
// formatDecimal for density.
const formatPrice = (value: string): string => {
  const num = parseFloat(value);
  return Number.isNaN(num) ? value : num.toString();
};

interface PatternCardProps {
  id: string;
  title: string;
  primaryProductType?: string;
  instruments?: string[];
  // Card-sized derivative — always the right field for a card context, see
  // Pattern.thumbnailUrl's own comment (patternsApi.ts). Every call site
  // passes a full Pattern via {...pattern} spread, so this just needs to
  // match that field's name to pick it up automatically.
  thumbnailUrl: string;
  isFree: boolean;
  isNew?: boolean;
  price?: string | null;
  oldPrice?: string | null;
  // Fired before navigation, e.g. so the caller can log a search-query
  // click-through while it still knows the active search context.
  onBeforeNavigate?: () => void;
  // Saves the caller's scroll position for the catalog's "back" restoration
  // (see Catalog.tsx's catalog_scroll handling). Default true matches every
  // existing call site (Catalog, Favorites); set false when rendering this
  // card somewhere that ISN'T the catalog (e.g. the "Похожие описания" row
  // on the detail page) — otherwise it clobbers catalog_scroll with a
  // meaningless value and corrupts the next real "back to catalog" restore.
  preserveCatalogScroll?: boolean;
}

export const PatternCard: React.FC<PatternCardProps> = ({ id, title, primaryProductType, instruments, thumbnailUrl, isFree, isNew, price, oldPrice, onBeforeNavigate, preserveCatalogScroll = true }) => {
  const navigate = useNavigate();
  const { isFavorite, toggleFavorite } = useFavorites();

  const favorite = isFavorite(id);
  // A price of exactly 0 means the item is free (see the scraper's
  // normalize_free_price) — isFree/the "Бесплатно" badge already covers
  // that, so the price row itself should stay empty rather than show
  // "0 ₽". Also suppressed whenever isFree is true regardless of the
  // stored price value — isFree can be a manual admin decision independent
  // of price (e.g. a listing that shows a price on-site but is offered free
  // here), and showing both the badge and a price would read as
  // contradictory.
  const hasPrice = !isFree && price != null && parseFloat(price) > 0;
  // oldPrice only renders as a discount when it's genuinely higher than the
  // current price — guards against a data-entry mistake reading as a price
  // INCREASE instead of a markdown.
  const hasDiscount = hasPrice && oldPrice != null && parseFloat(oldPrice) > parseFloat(price as string);

  const handleCardClick = () => {
    onBeforeNavigate?.();
    if (preserveCatalogScroll) {
      sessionStorage.setItem('catalog_scroll', window.scrollY.toString());
    }
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
          src={thumbnailUrl}
          alt={title}
          className="pattern-card-image"
          loading="lazy"
          decoding="async"
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
        {/* Always rendered (even with no price) so every card in the grid
            reserves the same content height — see PatternCard.css. */}
        <div className="pattern-price-row">
          {hasPrice && (
            <>
              <span className="pattern-price-current">{formatPrice(price as string)} ₽</span>
              {hasDiscount && (
                <span className="pattern-price-old">{formatPrice(oldPrice as string)} ₽</span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
