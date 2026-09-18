import React, { useRef, useState } from 'react';
import { ImageWithRetry } from '../../components/ImageWithRetry/ImageWithRetry';

interface CarouselProps {
  images: string[];
  alt: string;
  // Префикс CSS-классов (image/track/slide/dots/dot) — позволяет
  // переиспользовать один и тот же scroll-snap карусель и для основной
  // галереи пряжи (stash-details-image-*), и для компактных миниатюр
  // готового изделия в разделе "Связано" (stash-usage-image-*), у каждой
  // свой размер/позиционирование в CSS.
  classPrefix?: string;
}

// Тот же паттерн, что PatternDetails.tsx использует для галереи фото
// описания (ImageCarousel) — CSS scroll-snap вместо touch-обработчиков,
// активный индекс считается по scrollLeft/clientWidth. Одно фото рендерится
// без трека/точек.
export const StashImageCarousel: React.FC<CarouselProps> = ({ images, alt, classPrefix = 'stash-details-image' }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  if (images.length <= 1) {
    return <ImageWithRetry src={images[0]} alt={alt} className={classPrefix} />;
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
      <div className={`${classPrefix}-track`} ref={trackRef} onScroll={handleScroll}>
        {images.map((src, index) => (
          <ImageWithRetry
            key={index}
            src={src}
            alt={`${alt} ${index + 1}`}
            className={`${classPrefix}-slide`}
            loading={index <= 1 ? 'eager' : 'lazy'}
            decoding="async"
          />
        ))}
      </div>
      <div className={`${classPrefix}-dots`}>
        {images.map((_, index) => (
          <button
            key={index}
            type="button"
            className={`${classPrefix}-dot${index === activeIndex ? ` ${classPrefix}-dot--active` : ''}`}
            onClick={() => scrollToIndex(index)}
            aria-label={`Фото ${index + 1}`}
          />
        ))}
      </div>
    </>
  );
};
