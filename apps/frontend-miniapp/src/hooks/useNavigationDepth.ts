import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType, type Location } from 'react-router-dom';

// Сколько переходов вглубь сделано В ЭТОМ документе.
//
// Модульная переменная выбрана намеренно, вместо sessionStorage или
// history.state: она исчезает ровно тогда, когда документ пересоздан, — это и
// есть нужный сигнал. Проверки, которые напрашиваются первыми (`location.key`,
// `idx`), лежат в history.state, а он перезагрузку переживает. Поэтому после
// того, как WebView поднял приложение заново — например, когда человек
// вернулся с сайта автора и попал сразу на карточку описания, — они выглядят
// так, будто позади есть страница, хотя её нет. Кнопка «Назад» уходила в
// navigate(-1), шагала за пределы приложения, и снаружи это выглядело как
// «кнопка не нажимается».
let depth = 0;

function trackNavigation(type: string): void {
  if (type === 'PUSH') depth += 1;
  else if (type === 'POP') depth = Math.max(0, depth - 1);
  // REPLACE глубину не меняет — запись истории остаётся той же.
}

// Есть ли куда возвращаться внутри приложения.
export function canGoBackInApp(): boolean {
  return depth > 0;
}

// Вешается один раз в App.
//
// Зависимость — объект location, а не location.key: ключ у записи истории
// повторяется, когда на неё возвращаются (у каталога он всегда 'default'), и
// эффект на такой зависимости пропустил бы часть переходов.
export function useNavigationDepthTracker(): void {
  const location = useLocation();
  const navigationType = useNavigationType();
  const lastLocationRef = useRef<Location | null>(null);

  useEffect(() => {
    // StrictMode в разработке прогоняет эффекты дважды. Второй прогон увидит
    // тот же объект и выйдет — иначе один PUSH считался бы за два.
    if (lastLocationRef.current === location) return;
    lastLocationRef.current = location;
    trackNavigation(navigationType);
  }, [location, navigationType]);
}
