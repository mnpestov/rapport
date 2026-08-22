import React, { useEffect, useRef, useState } from 'react';

// Браузер никогда не повторяет неудачную загрузку картинки сам, а ключи в
// списках у нас стабильные (key={pattern.id}), поэтому React не пересоздаёт
// <img> и второго запроса не будет никогда. В итоге один оборванный запрос
// оставлял пустое место до конца сессии.
//
// Обрыв при этом — нормальное поведение, а не сбой: браузер прекращает
// загрузку, когда элемент уходит из DOM (пользователь тапнул по карточке или
// пролистнул, пока сетка догружалась). В логах nginx это видно как ответ 200
// с нулём отданных байт. Файл на сервере целый, поэтому повтор почти всегда
// доезжает.
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [400, 1200];

type ImageWithRetryProps = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'onError' | 'style'
> & {
  src: string;
};

export const ImageWithRetry: React.FC<ImageWithRetryProps> = ({ src, ...rest }) => {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [trackedSrc, setTrackedSrc] = useState(src);
  const timerRef = useRef<number | null>(null);

  // Тот же инстанс может получить другую картинку: переход по «похожим
  // описаниям» не размонтирует страницу, а подменяет images у живых слайдов.
  // Сбрасываем прямо в рендере, а не в эффекте — иначе новая картинка успела
  // бы отрисоваться скрытой и с исчерпанными попытками предыдущей.
  if (trackedSrc !== src) {
    setTrackedSrc(src);
    setAttempt(0);
    setFailed(false);
  }

  // Снимаем отложенный повтор и при размонтировании, и при смене src: иначе
  // сработавший позже таймер дёрнул бы перезагрузку уже другой картинки.
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [src]
  );

  const handleError = () => {
    if (attempt >= MAX_RETRIES) {
      setFailed(true);
      return;
    }
    const delay = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    timerRef.current = window.setTimeout(() => setAttempt((prev) => prev + 1), delay);
  };

  return (
    <img
      // Повторно выставленный тот же src нового запроса не вызывает — нужен
      // именно новый элемент, поэтому номер попытки участвует в key.
      key={attempt}
      {...rest}
      src={src}
      onError={handleError}
      // Когда попытки исчерпаны, прячем картинку целиком: иначе поверх серой
      // подложки контейнера браузер дорисует alt-текст и иконку битого файла.
      // Подложка у контейнеров уже есть (.pattern-card-image-container,
      // .details-image-container), так что остаётся ровный серый прямоугольник
      // вместо дыры.
      style={failed ? { visibility: 'hidden' } : undefined}
    />
  );
};
