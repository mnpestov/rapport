import React, { useEffect, useRef, useState } from 'react';

// Картинки в мини-аппе отваливаются двумя разными способами, и лечатся они
// по-разному.
//
// 1. Запрос оборвался. Браузер сам повтор не делает никогда, а ключи в
//    списках у нас стабильные (key={pattern.id}), поэтому React не
//    пересоздаёт <img> и второго запроса не будет. Ловится по onError.
//
// 2. Загрузка зависла на середине. Браузер получил часть байтов, прогрессивно
//    отрисовал их и ждёт остального: половина фото видна, половина серая. Для
//    него загрузка всё ещё идёт, поэтому onError НЕ сработает, а complete
//    останется false. В логах nginx это видно как ответ 200 с неполным
//    числом отданных байт. События прогресса у <img> нет, так что единственный
//    способ это заметить — сторожевой таймер.
const MAX_RETRIES = 2;
// Обрыв: повторяем быстро, соединение уже закрыто.
const ERROR_RETRY_DELAYS_MS = [400, 1200];
// Зависание: соединение ещё живо и, судя по всему, залипло. Даём ему время
// умереть, иначе повтор рискует залипнуть там же — это совпадает с тем, что
// помогает вручную: выйти, подождать, вернуться.
const STALL_RETRY_DELAYS_MS = [1000, 3000];
// Первая проверка быстрая: залипшую картинку надо перезапустить раньше, чем
// человек успеет решить, что приложение сломалось. Дальше порог растёт — если
// картинка не залипла, а просто медленно едет по слабой сети, второй и третий
// заход дают ей доехать, вместо того чтобы рвать её с начала по кругу.
const STALL_TIMEOUTS_MS = [3_000, 6_000, 12_000];

// Ленивая картинка вне экрана честно не завершена — грузиться она ещё не
// начинала. Проверяем обе оси: слайды галереи уезжают по горизонтали.
const isNearViewport = (el: HTMLElement): boolean => {
  const rect = el.getBoundingClientRect();
  return (
    rect.bottom > -window.innerHeight &&
    rect.top < window.innerHeight * 2 &&
    rect.right > -window.innerWidth &&
    rect.left < window.innerWidth * 2
  );
};

type ImageWithRetryProps = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'onError' | 'onLoad' | 'style' | 'ref'
> & {
  src: string;
};

export const ImageWithRetry: React.FC<ImageWithRetryProps> = ({ src, ...rest }) => {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [trackedSrc, setTrackedSrc] = useState(src);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const stallTimerRef = useRef<number | null>(null);

  // Тот же инстанс может получить другую картинку: переход по «похожим
  // описаниям» не размонтирует страницу, а подменяет images у живых слайдов.
  // Сбрасываем прямо в рендере, а не в эффекте — иначе новая картинка успела
  // бы отрисоваться скрытой и с исчерпанными попытками предыдущей.
  if (trackedSrc !== src) {
    setTrackedSrc(src);
    setAttempt(0);
    setFailed(false);
  }

  const scheduleRetry = (delays: number[]) => {
    if (attempt >= MAX_RETRIES) {
      // Прячем только то, что не нарисовалось вообще. Зависшая картинка
      // показывает верхнюю половину фото — это хуже целого, но лучше пустоты,
      // и отнимать у человека уже отрисованное мы не будем.
      setFailed((imgRef.current?.naturalWidth ?? 0) === 0);
      return;
    }
    const delay = delays[attempt] ?? delays[delays.length - 1];
    retryTimerRef.current = window.setTimeout(() => setAttempt((prev) => prev + 1), delay);
  };

  // Сторож зависшей загрузки. Живёт ровно одну попытку: перезапускается при
  // смене src или номера попытки, снимается при успехе и при размонтировании.
  useEffect(() => {
    if (failed) return;

    const timeout = STALL_TIMEOUTS_MS[attempt] ?? STALL_TIMEOUTS_MS[STALL_TIMEOUTS_MS.length - 1];

    const tick = () => {
      const img = imgRef.current;
      // complete === true means the browser finished — successfully or via
      // onError, which has its own retry path. Either way, not our case.
      if (!img || img.complete) return;

      if (!isNearViewport(img)) {
        // Ленивая картинка просто ждёт своей очереди. Не трогаем, но и не
        // забываем: она может залипнуть позже, когда до неё долистают.
        stallTimerRef.current = window.setTimeout(tick, timeout);
        return;
      }

      scheduleRetry(STALL_RETRY_DELAYS_MS);
    };

    stallTimerRef.current = window.setTimeout(tick, timeout);

    return () => {
      if (stallTimerRef.current !== null) {
        window.clearTimeout(stallTimerRef.current);
        stallTimerRef.current = null;
      }
    };
  }, [src, attempt, failed]);

  // Отложенный повтор снимаем и при размонтировании, и при смене src: иначе
  // сработавший позже таймер дёрнул бы перезагрузку уже другой картинки.
  useEffect(
    () => () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    },
    [src]
  );

  return (
    <img
      // Повторно выставленный тот же src нового запроса не вызывает — нужен
      // именно новый элемент, поэтому номер попытки участвует в key.
      key={attempt}
      {...rest}
      ref={imgRef}
      src={src}
      onError={() => scheduleRetry(ERROR_RETRY_DELAYS_MS)}
      onLoad={() => {
        if (stallTimerRef.current !== null) {
          window.clearTimeout(stallTimerRef.current);
          stallTimerRef.current = null;
        }
      }}
      // Когда попытки исчерпаны и рисовать нечего, прячем картинку целиком:
      // иначе поверх серой подложки контейнера браузер дорисует alt-текст и
      // иконку битого файла. Подложка у контейнеров уже есть
      // (.pattern-card-image-container, .details-image-container), так что
      // остаётся ровный серый прямоугольник вместо дыры.
      style={failed ? { visibility: 'hidden' } : undefined}
    />
  );
};
