import React, { useState } from 'react';
import { ImageWithRetry } from '../../components/ImageWithRetry/ImageWithRetry';

interface StashImageGalleryDesktopProps {
  images: string[];
  alt: string;
}

// Десктопная галерея карточки пряжи (Figma node-id=1659:22930) — клик по
// миниатюре слева выбирает фото в большом кадре справа. Без инлайн-добавления
// фото (в макете его нет) — загрузка остаётся только в EditSkeinModal, как и
// на мобиле (StashImageCarousel там не трогаем). Пустой images[] — забота
// вызывающей стороны (тот же placeholder-ветвление, что у StashImageCarousel
// на мобиле), этот компонент предполагает непустой массив.
export const StashImageGalleryDesktop: React.FC<StashImageGalleryDesktopProps> = ({ images, alt }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  return (
    <div className="stash-gallery-desktop">
      {images.length > 1 && (
        <div className="stash-gallery-desktop-thumbs">
          {images.map((src, index) => (
            <button
              key={index}
              type="button"
              className={`stash-gallery-desktop-thumb${index === selectedIndex ? ' stash-gallery-desktop-thumb--active' : ''}`}
              onClick={() => setSelectedIndex(index)}
              aria-label={`Фото ${index + 1}`}
            >
              <ImageWithRetry src={src} alt="" />
            </button>
          ))}
        </div>
      )}
      <div className="stash-gallery-desktop-main">
        <ImageWithRetry src={images[selectedIndex]} alt={alt} />
      </div>
    </div>
  );
};
