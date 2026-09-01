import React, { useState, useEffect, useLayoutEffect } from 'react';
import { X, Search, Lock } from 'lucide-react';
import { CustomSquareUncheck, CustomSquareCheck, CustomChevronDown } from '../Icons/Icons';
import { fetchFilters, FiltersResponse, FilterOption } from '../../api/patternsApi';
import { submitPaywallEvent } from '../../api/paywallApi';
import { usePremiumAccess } from '../../hooks/usePremiumAccess';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import '../../styles/sheet.css';
import './FilterModal.css';

interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (selectedFilters: SelectedFilters) => void;
  initialFilters: SelectedFilters;
}

export interface SelectedFilters {
  categories: string[];
  tags: string[];
  instruments: string[];
  authors: string[];
  yarnRanges: string[];
  density: string[];
  // Not a facet like the six above (no discrete option list to pick from —
  // it's a continuous range), so it deliberately isn't a key of
  // FiltersResponse and doesn't go through renderSection/handleToggle.
  // '' means unset, matching how the two inputs themselves are controlled.
  priceMin: string;
  priceMax: string;
}

interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (selectedFilters: SelectedFilters) => void;
  initialFilters: SelectedFilters;
  filtersData: FiltersResponse | null;
  loading: boolean;
  // How to re-fetch each section's narrowed option list as the draft
  // selection changes. Defaults to the real network fetchFilters (catalog,
  // faceted against the whole DB). Favorites passes a synchronous
  // client-side computation over its already-loaded pattern list instead —
  // see clientPatternFilters.ts's computeFacetsFromPatterns — wrapped in a
  // resolved Promise so this component's debounce/abort plumbing doesn't
  // need to know which case it's in.
  fetchFacets?: (selected: SelectedFilters, signal: AbortSignal) => Promise<FiltersResponse>;
}

const defaultFetchFacets = (selected: SelectedFilters, signal: AbortSignal) =>
  fetchFilters({ ...selected, signal });

// Плавное раскрытие через grid-template-rows: 0fr → 1fr. Высоту тела не
// измеряем и не задаём: она у секций разная и меняется на лету (поиск внутри
// секции, пересчёт фасетов), а любой max-height пришлось бы брать с запасом —
// тогда анимация идёт «пустую» часть запаса и выглядит рваной.
//
// Объявлен на уровне модуля намеренно: определи его внутри FilterModal, и
// каждый рендер давал бы React новый тип компонента — тело секции
// размонтировалось бы и монтировалось заново, теряя фокус в поле поиска.
const Collapsible: React.FC<{ open: boolean; durationMs: number; children: React.ReactNode }> = ({ open, durationMs, children }) => (
  <div
    className={`filter-collapsible${open ? ' filter-collapsible--open' : ''}`}
    style={{ '--filter-collapse-ms': `${durationMs}ms` } as React.CSSProperties}
  >
    <div className="filter-collapsible-inner">{children}</div>
  </div>
);

// Раскрытие идёт с постоянной СКОРОСТЬЮ, а не за постоянное время. Секции
// разной высоты проезжают разный путь: «Инструмент» — сотню пикселей,
// «Автор» — под две тысячи. При общей длительности первая ползёт, вторая
// пролетает так, что раскрытия не видно вовсе.
//
// Границы обязательны с обеих сторон: без нижней короткая секция дёргалась
// бы за 50 мс, без верхней закрытие длинной длилось бы секунду — а при
// закрытии движение видно всё время, содержимое снизу едет вверх.
const REVEAL_PX_PER_MS = 2.2;
const MIN_REVEAL_MS = 200;
const MAX_REVEAL_MS = 600;

const revealDurationMs = (distancePx: number) =>
  Math.round(Math.min(MAX_REVEAL_MS, Math.max(MIN_REVEAL_MS, distancePx / REVEAL_PX_PER_MS)));

// Высота тела считается по разметке, а не измеряется в DOM, намеренно.
// Измерение — это принудительный пересчёт layout, и сделать его нужно было бы
// РАНЬШЕ смены класса: браузер запоминает длительность в тот момент, когда
// стартует переход, и выставленная после этого переменная досталась бы уже
// следующему раскрытию. Оценка же уезжает в DOM тем же коммитом, что и класс.
// Точность здесь ни к чему — от числа зависит только темп.
const ROW_PX = 44;          // строка опции: иконка 32 + gap 12 из .filter-section-body
const SEARCH_ROW_PX = 60;   // поле поиска 48 + тот же gap
const BODY_PADDING_PX = 24; // padding 8px сверху + 16px снизу
const PRICE_BODY_PX = SEARCH_ROW_PX + BODY_PADDING_PX;

const estimateBodyPx = (optionsCount: number, hasSearchRow: boolean) =>
  BODY_PADDING_PX + (hasSearchRow ? SEARCH_ROW_PX : 0) + optionsCount * ROW_PX;

export const FilterModal: React.FC<FilterModalProps> = ({ isOpen, onClose, onApply, initialFilters, filtersData, loading, fetchFacets = defaultFetchFacets }) => {
  // Держит шторку в дереве на время выезда вниз и даёт класс для
  // открытого состояния — сам по себе `isOpen` размонтировал бы её
  // мгновенно, до анимации закрытия.
  const { isMounted, isVisible, sheetRef } = useSheetTransition(isOpen);
  // Density/yarn-thickness sections require PREMIUM_CORE, price requires
  // PREMIUM_EXTRA — renderSection always renders its header regardless of
  // whether options is empty, so gating has to happen at the call site, not
  // inside it. See PAID_TIER_PERMISSIONS_PLAN.md §3.4.
  //
  // Без доступа секция больше не исчезает, а показывается замком
  // (renderLockedSection): бесплатный пользователь видит полный список
  // фильтров и понимает, что именно даёт подписка — иначе о платных
  // фильтрах неоткуда узнать. Сам доступ этим не ослаблен: раскрыть такую
  // секцию нельзя, значений в `selected` не появляется, а бэкенд и так
  // игнорирует платные параметры без разрешения (§3.4).
  //
  // `paywallUiEnabled` — тот же единственный выключатель всех платных
  // поверхностей, что у баннера и кнопки подписки (authController.ts): до
  // публичного запуска обычный пользователь платного UI не видит вовсе, и
  // замки для него — четвёртая такая поверхность, а не исключение.
  const { core, extra, paywallUiEnabled } = usePremiumAccess();
  const [selected, setSelected] = useState<SelectedFilters>(initialFilters);
  const [isPriceExpanded, setIsPriceExpanded] = useState(false);
  // Live, narrowed option lists — recomputed server-side (see the effect
  // below) as `selected` changes, so e.g. picking a category prunes density
  // options down to what actually occurs on patterns in that category.
  // `filtersData` (the unfiltered universe, fetched once by Catalog) is used
  // as the seed/fallback and as the name lookup for "stale" options below.
  const [facetData, setFacetData] = useState<FiltersResponse | null>(filtersData);
  const [expandedSections, setExpandedSections] = useState<Array<keyof FiltersResponse>>([]);
  // Какие секции уже открывали хоть раз. Свёрнутая секция теперь остаётся в
  // DOM (иначе анимировать закрытие нечем), но монтировать содержимое всех
  // шести сразу при открытии шторки — это сотни строк с иконками у density и
  // authors и заметный фриз на слабом Android. Поэтому тело появляется при
  // первом раскрытии и дальше живёт вместе с секцией; больше шести таких
  // тел набраться не может.
  const [openedSections, setOpenedSections] = useState<Array<keyof FiltersResponse>>([]);
  // Секция, которую попросили раскрыть ВПЕРВЫЕ: тело для неё уже
  // смонтировано, но класс раскрытия ещё не выставлен — см. useLayoutEffect
  // ниже. Для уже открывавшихся секций всегда null, там раскрытие идёт одним
  // шагом.
  const [pendingSection, setPendingSection] = useState<keyof FiltersResponse | null>(null);
  // Какие варианты поднимать наверх списка. Это СНИМОК выбранного на момент
  // раскрытия секции, а не живой `selected`: пересортируй список прямо по
  // тапу — и отмеченная строка тут же улетает вверх, а на её место под
  // пальцем встаёт соседняя. Отметить пять авторов подряд после этого
  // невозможно. Снимок обновляется при каждом раскрытии секции и при
  // открытии шторки, так что «выбранное сверху» пользователь видит ровно
  // тогда, когда ему это нужно — заходя в секцию.
  const [hoistedIds, setHoistedIds] = useState<Partial<Record<keyof FiltersResponse, string[]>>>({});
  const [filterSearches, setFilterSearches] = useState<Record<keyof FiltersResponse, string>>({
    categories: '',
    tags: '',
    instruments: '',
    authors: '',
    yarnRanges: '',
    density: '' // unused — density has its own two-input search below, kept only to satisfy the Record type
  });
  // Density's search is two independent numeric fields ("п." / "р."), unlike
  // every other section's single free-text box — needs its own state shape.
  const [densitySearch, setDensitySearch] = useState({ stitches: '', rows: '' });

  useEffect(() => {
    if (isOpen) {
      setSelected(initialFilters);
      setHoistedIds({
        categories: initialFilters.categories,
        tags: initialFilters.tags,
        instruments: initialFilters.instruments,
        authors: initialFilters.authors,
        yarnRanges: initialFilters.yarnRanges,
        density: initialFilters.density,
      });
    }
  }, [isOpen, initialFilters]);

  // Debounced faceted refetch: whenever the draft selection changes while the
  // modal is open, ask the backend for option lists narrowed to everything
  // *except* each section's own picks (self-exclusion happens server-side).
  // Skipped (cheap, no network) when nothing is selected — that's exactly
  // the unfiltered `filtersData` Catalog already fetched once.
  useEffect(() => {
    if (!isOpen) return;

    const isEmpty = selected.categories.length === 0 && selected.tags.length === 0 &&
      selected.instruments.length === 0 && selected.authors.length === 0 &&
      selected.yarnRanges.length === 0 && selected.density.length === 0;

    if (isEmpty) {
      setFacetData(filtersData);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchFacets(selected, controller.signal)
        .then(setFacetData)
        .catch(err => {
          if (err instanceof Error && err.name === 'AbortError') return;
          console.error(err);
        });
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [selected, isOpen, filtersData, fetchFacets]);

  // Ровно тот же приём и по той же причине, что в useSheetTransition: если
  // тело секции монтируется тем же коммитом, каким выставляется класс
  // раскрытия, браузеру не от чего анимировать — открытое состояние он
  // считает начальным, и секция раскрывается рывком. Причём непредсказуемо:
  // у «Цены» тело смонтировано всегда, поэтому она шла плавно, а любая
  // секция при ПЕРВОМ раскрытии — рывком, дальше плавно. Отсюда и
  // «иногда мгновенно, иногда плавно».
  //
  // Чтение offsetHeight принудительно считает layout со свёрнутым, но уже
  // смонтированным телом — это и становится состоянием «до», от которого
  // браузер анимирует следующую смену класса. rAF здесь не годится по тем
  // же причинам, что разобраны в useSheetTransition.ts.
  useLayoutEffect(() => {
    if (!pendingSection) return;
    void sheetRef.current?.offsetHeight;
    const key = pendingSection;
    setPendingSection(null);
    setExpandedSections(prev => prev.includes(key) ? prev : [...prev, key]);
  }, [pendingSection, sheetRef]);

  if (!isMounted) return null;

  const toggleSection = (sectionKey: keyof FiltersResponse) => {
    if (expandedSections.includes(sectionKey)) {
      setExpandedSections(prev => prev.filter(k => k !== sectionKey));
      return;
    }
    // Пересобираем порядок ровно в момент раскрытия — пока секция открыта,
    // список под пальцем не шевелится.
    setHoistedIds(prev => ({ ...prev, [sectionKey]: selected[sectionKey] }));
    if (!openedSections.includes(sectionKey)) {
      // Первое раскрытие — в два шага: сначала смонтировать тело свёрнутым,
      // и только потом раскрыть.
      setOpenedSections(prev => [...prev, sectionKey]);
      setPendingSection(sectionKey);
      return;
    }
    setExpandedSections(prev => [...prev, sectionKey]);
  };

  const handleToggle = (section: keyof FiltersResponse, id: string) => {
    setSelected(prev => {
      const currentList = prev[section];
      if (currentList.includes(id)) {
        return { ...prev, [section]: currentList.filter(item => item !== id) };
      } else {
        return { ...prev, [section]: [...currentList, id] };
      }
    });
  };

  const handleReset = () => {
    setSelected({ categories: [], tags: [], instruments: [], authors: [], yarnRanges: [], density: [], priceMin: '', priceMax: '' });
    setDensitySearch({ stitches: '', rows: '' });
  };

  const handleApply = () => {
    onApply(selected);
    onClose();
  };

  // Шторка подписки живёт в App.tsx — отсюда она открывается window-событием,
  // тем же приёмом, что и кнопка подписки в строке поиска (SearchFilterBar).
  // Шторку фильтров при этом НЕ закрываем: баннер перекрывает её сверху, и
  // после закрытия человек возвращается к своему незавершённому набору
  // фильтров, а не начинает заново.
  const handleLockedClick = () => {
    submitPaywallEvent('BUTTON_OPENED', 'FILTER_LOCK');
    window.dispatchEvent(new CustomEvent('paywall:open', { detail: { source: 'FILTER_LOCK' } }));
  };

  // Платная секция без доступа: тот же заголовок на своём месте, но
  // приглушённый, с замком вместо стрелки и без тела. Не <button disabled> —
  // тап по ней должен работать, он и есть точка входа в оплату; для
  // скринридера состояние передаёт aria-disabled.
  const renderLockedSection = (title: string) => (
    <div className="filter-section">
      <button
        className="filter-section-header filter-section-header--locked"
        onClick={handleLockedClick}
        aria-disabled="true"
      >
        <span className="filter-section-title">{title}</span>
        {/* Тот же бокс 32×32, что у стрелки (её svg именно такого размера) —
            иначе платные строки оказались бы ниже остальных. */}
        <span className="filter-section-lock">
          <Lock size={20} />
        </span>
      </button>
    </div>
  );

  // Bespoke, not routed through renderSection — price is a continuous range,
  // not a facet with a discrete option list (handleToggle/staleIds/
  // facetData narrowing don't apply). Gated on `extra`, not `core` like
  // yarnRanges/density below — price/oldPrice are PREMIUM_EXTRA-only
  // (patternVisibility.ts's PATTERN_PRICE_OMIT), a completely independent
  // permission from PREMIUM_CORE. Same visual chrome (filter-section-header
  // with the chevron) as every other section, for consistency.
  const renderPriceSection = () => (
    <div className="filter-section">
      <button
        className="filter-section-header"
        aria-expanded={isPriceExpanded}
        onClick={() => setIsPriceExpanded(v => !v)}
      >
        <span className="filter-section-title">Цена</span>
        {/* Одна и та же стрелка вниз, повёрнутая на 180° в раскрытом
            состоянии — так поворот анимируется (подмена двух разных иконок
            была бы мгновенной). */}
        <span className={`filter-section-chevron${isPriceExpanded ? ' filter-section-chevron--expanded' : ''}`}>
          <CustomChevronDown size={32} />
        </span>
      </button>
      <Collapsible open={isPriceExpanded} durationMs={revealDurationMs(PRICE_BODY_PX)}>
        <div className="filter-section-body">
          <div className="filter-density-search-row">
            <input
              type="number"
              inputMode="numeric"
              placeholder="от"
              className="filter-search-input filter-density-input"
              value={selected.priceMin}
              onChange={(e) => setSelected(prev => ({ ...prev, priceMin: e.target.value }))}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="filter-density-search-label">—</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="до"
              className="filter-search-input filter-density-input"
              value={selected.priceMax}
              onChange={(e) => setSelected(prev => ({ ...prev, priceMax: e.target.value }))}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="filter-density-search-label">р.</span>
            {/* Same reasoning as density's clear button — always rendered,
                visibility-toggled, so the two flex:1 inputs above don't
                shrink/grow (14px each, measured live) when this appears. */}
            <button
              className="filter-search-clear"
              onClick={(e) => { e.stopPropagation(); setSelected(prev => ({ ...prev, priceMin: '', priceMax: '' })); }}
              style={{ visibility: (selected.priceMin || selected.priceMax) ? 'visible' : 'hidden' }}
              tabIndex={(selected.priceMin || selected.priceMax) ? 0 : -1}
            >
              <X size={20} />
            </button>
          </div>
        </div>
      </Collapsible>
    </div>
  );

  const renderSection = (title: string, sectionKey: keyof FiltersResponse) => {
    const isExpanded = expandedSections.includes(sectionKey);
    const hasOpened = openedSections.includes(sectionKey);
    // Совпадает с условием рендера поля поиска ниже: у «Инструмента» и
    // «Толщины пряжи» его нет, у «Плотности» вместо него свой ряд из двух
    // инпутов — по высоте это то же самое.
    const hasSearchRow = sectionKey !== 'instruments' && sectionKey !== 'yarnRanges';
    // `facetData` is the live, narrowed list (falls back to the unfiltered
    // `filtersData` until the first facet response arrives). An already-
    // checked value that fell out of the narrowed list is merged back in
    // (looked up by id in the unfiltered universe) and flagged as "stale" —
    // it stays visible/checked so the user can see and deselect it, instead
    // of silently vanishing or silently being unchecked.
    const activeData = facetData || filtersData;
    const hasData = activeData && activeData[sectionKey];
    let options = hasData ? [...activeData[sectionKey]] : [];

    const staleIds = new Set<string>();
    const liveIds = new Set(options.map(o => o.id));
    const universalOptions = filtersData?.[sectionKey] || [];
    for (const id of selected[sectionKey]) {
      if (!liveIds.has(id)) {
        const found = universalOptions.find(o => o.id === id);
        if (found) {
          options.push(found);
          staleIds.add(id);
        }
      }
    }

    // Alphabetical sort — except yarnRanges (fixed bucket order via backend
    // sortOrder) and density (backend already returns it numerically sorted
    // by stitches then rows; alphabetical would scatter "20 п. × 32 р." vs
    // "9 п. × 12 р." lexicographically instead of numerically).
    if (sectionKey !== 'yarnRanges' && sectionKey !== 'density') {
      options.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    }

    // Выбранное — наверх. Внутри обеих групп порядок сохраняется тот, что
    // получился выше (алфавит, а у yarnRanges/density — порядок бэкенда):
    // filter стабилен, поэтому пересортировка ничего больше не перемешивает.
    const hoisted = hoistedIds[sectionKey];
    if (hoisted && hoisted.length > 0) {
      const isHoisted = new Set(hoisted);
      options = [
        ...options.filter(o => isHoisted.has(o.id)),
        ...options.filter(o => !isHoisted.has(o.id)),
      ];
    }

    // Apply search — density uses two independent numeric prefix matches
    // (stitches, rows) against its "stitchesxrows" id instead of the shared
    // single free-text search everyone else uses.
    if (sectionKey === 'density') {
      const stitchesQuery = densitySearch.stitches.trim();
      const rowsQuery = densitySearch.rows.trim();
      if (stitchesQuery || rowsQuery) {
        options = options.filter(o => {
          const [idStitches, idRows] = o.id.split('x');
          const matchesStitches = !stitchesQuery || idStitches.startsWith(stitchesQuery);
          const matchesRows = !rowsQuery || idRows.startsWith(rowsQuery);
          return matchesStitches && matchesRows;
        });
      }
    } else {
      const q = filterSearches[sectionKey]?.trim().toLowerCase();
      if (q) {
        options = options.filter(o => o.name.toLowerCase().includes(q));
      }
    }

    return (
      <div className="filter-section">
        <button
          className="filter-section-header"
          aria-expanded={isExpanded}
          onClick={() => toggleSection(sectionKey)}
        >
          <span className="filter-section-heading">
            <span className="filter-section-title">{title}</span>
            {/* Считаем весь selected по секции, включая «протухшие» варианты
                (те, что выпали из суженного списка, но остаются отмеченными
                — см. staleIds выше): для пользователя они выбраны так же,
                как остальные. При нуле не рисуем ничего — «(0)» ничего не
                сообщает. */}
            {selected[sectionKey].length > 0 && (
              <span className="filter-section-count">({selected[sectionKey].length})</span>
            )}
          </span>
          <span className={`filter-section-chevron${isExpanded ? ' filter-section-chevron--expanded' : ''}`}>
            <CustomChevronDown size={32} />
          </span>
        </button>
        <Collapsible
          open={isExpanded}
          durationMs={revealDurationMs(estimateBodyPx(options.length, hasSearchRow))}
        >
          {hasOpened && (
            <div className="filter-section-body">
              {sectionKey === 'density' ? (
                <div className="filter-density-search-row">
                  <input
                    type="number"
                    inputMode="numeric"
                    // placeholder="20"
                    className="filter-search-input filter-density-input"
                    value={densitySearch.stitches}
                    onChange={(e) => setDensitySearch(prev => ({ ...prev, stitches: e.target.value }))}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="filter-density-search-label">п. ×</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    // placeholder="32"
                    className="filter-search-input filter-density-input"
                    value={densitySearch.rows}
                    onChange={(e) => setDensitySearch(prev => ({ ...prev, rows: e.target.value }))}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="filter-density-search-label">р.</span>
                  {/* Always rendered — reserves its space in the flex row at
                      all times so the two flex:1 inputs don't lose/regain
                      width (split evenly between them) as this shows up. */}
                  <button
                    className="filter-search-clear"
                    onClick={(e) => { e.stopPropagation(); setDensitySearch({ stitches: '', rows: '' }); }}
                    style={{ visibility: (densitySearch.stitches || densitySearch.rows) ? 'visible' : 'hidden' }}
                    tabIndex={(densitySearch.stitches || densitySearch.rows) ? 0 : -1}
                  >
                    <X size={20} />
                  </button>
                </div>
              ) : sectionKey !== 'instruments' && sectionKey !== 'yarnRanges' && (
                <div className="filter-search-input-wrapper filter-search-inline">
                  <Search size={20} className="filter-search-icon" />
                  <input
                    type="text"
                    placeholder="Поиск..."
                    className="filter-search-input"
                    value={filterSearches[sectionKey]}
                    onChange={(e) => setFilterSearches(prev => ({ ...prev, [sectionKey]: e.target.value }))}
                    onClick={(e) => e.stopPropagation()}
                  />
                  {/* Same reasoning as density's clear button above. */}
                  <button
                    className="filter-search-clear"
                    onClick={(e) => { e.stopPropagation(); setFilterSearches(prev => ({ ...prev, [sectionKey]: '' })); }}
                    style={{ visibility: filterSearches[sectionKey] ? 'visible' : 'hidden' }}
                    tabIndex={filterSearches[sectionKey] ? 0 : -1}
                  >
                    <X size={20} />
                  </button>
                </div>
              )}
              {loading && <p className="filter-loading">Загрузка...</p>}
              {!loading && options.length === 0 && <p className="filter-empty">Ничего не найдено</p>}
              {!loading && options.map((opt: FilterOption) => {
                const isChecked = selected[sectionKey].includes(opt.id);
                const isStale = staleIds.has(opt.id);
                return (
                  <div
                    key={opt.id}
                    className={`filter-checkbox-label${isStale ? ' filter-checkbox-label--stale' : ''}`}
                    onClick={() => handleToggle(sectionKey, opt.id)}
                  >
                    <div className="filter-checkbox-custom">
                      {isChecked ? <CustomSquareCheck size={32} /> : <CustomSquareUncheck size={32} />}
                    </div>
                    <span className="filter-checkbox-text">{opt.name}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Collapsible>
      </div>
    );
  };

  return (
    <div ref={sheetRef} className={`filter-modal-overlay sheet-overlay ${isVisible ? 'sheet-open' : ''}`} onClick={onClose}>
      <div className="filter-modal-content sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="filter-modal-header">
          <button className="filter-close-btn" onClick={onClose}>
            <X size={24} />
          </button>
          <h2 className="filter-modal-title">Фильтр</h2>
          <div style={{ width: 24 }}></div> {/* Spacer for centering */}
        </div>

        <div className="filter-modal-body">
          {(extra || paywallUiEnabled) && (
            <>
              {extra ? renderPriceSection() : renderLockedSection('Цена')}
              <div className="filter-divider" />
            </>
          )}
          {renderSection("Тип изделия", "categories")}
          <div className="filter-divider" />
          {renderSection("Характеристики", "tags")}
          <div className="filter-divider" />
          {renderSection("Инструмент", "instruments")}
          <div className="filter-divider" />
          {renderSection("Автор", "authors")}
          {(core || paywallUiEnabled) && (
            <>
              <div className="filter-divider" />
              {core
                ? renderSection("Толщина пряжи (м/100г)", "yarnRanges")
                : renderLockedSection("Толщина пряжи (м/100г)")}
              <div className="filter-divider" />
              {core ? renderSection("Плотность", "density") : renderLockedSection("Плотность")}
            </>
          )}
        </div>

        <div className="filter-modal-footer">
          <button className="filter-reset-btn" onClick={handleReset}>Сбросить все</button>
          <button
            className="filter-apply-btn"
            onClick={handleApply}
            disabled={selected.categories.length === 0 && selected.tags.length === 0 && selected.instruments.length === 0 && selected.authors.length === 0 && selected.yarnRanges.length === 0 && selected.density.length === 0 && !selected.priceMin && !selected.priceMax}
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
};
