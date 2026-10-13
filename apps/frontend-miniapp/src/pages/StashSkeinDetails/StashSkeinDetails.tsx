import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { renderNoteWithLinks } from '../../utils/renderNoteWithLinks';
import { useNavigate, useParams } from 'react-router-dom';
import { Lock, Loader2, Plus, SquarePen, Trash2, Heart } from 'lucide-react';
import { fetchStashSkeinById, fetchStashMatches, undoStashUsage, deleteStashSwatch, deleteStashSkein, suggestYarnFields, updateStashSkein, StashSkeinDetail, StashMatchItem, StashUsage, StashSwatch } from '../../api/stashApi';
import { fetchProjects, ProjectListItem } from '../../api/projectsApi';
import { canGoBackInApp } from '../../hooks/useNavigationDepth';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { useFavorites } from '../../context/FavoritesContext';
import { Footer } from '../../components/Footer/Footer';
import { SwipeToDelete } from '../../components/SwipeToDelete/SwipeToDelete';
import { DeleteConfirmModal } from '../../components/DeleteConfirmModal/DeleteConfirmModal';
import { HeaderActionsMenu } from '../../components/HeaderActionsMenu/HeaderActionsMenu';
import { StashPaywallBanner } from '../../components/StashPaywallBanner/StashPaywallBanner';
import { CollapsibleSection } from '../Projects/CollapsibleSection';
import { AddSwatchModal } from './AddSwatchModal';
import { EditSkeinModal } from './EditSkeinModal';
import { EditSwatchModal } from './EditSwatchModal';
import { EditUsageModal } from './EditUsageModal';
import { LogUsageWizard } from './LogUsageWizard';
import { StashImageCarousel } from './StashImageCarousel';
import { StashImageGalleryDesktop } from './StashImageGalleryDesktop';
import arrowLeftIcon from '../../assets/arrow-left.svg';
import yarnPlaceholder from '../../assets/stash/yarn-placeholder.png';
import swatchPlaceholder from '../../assets/stash/swatchPlaceholder.svg';
import projectPlaceholder from '../../components/TabBar/icons/project1.svg';
import { STATUS_LABEL } from '../Projects/projectStatus';
import './StashSkeinDetails.css';

export const StashSkeinDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { isFavorite, toggleFavorite } = useFavorites();

  const [skein, setSkein] = useState<StashSkeinDetail | null>(null);
  const [matches, setMatches] = useState<StashMatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddSwatchOpen, setIsAddSwatchOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isLogUsageOpen, setIsLogUsageOpen] = useState(false);
  // Список "Выбрать из моих проектов" (шаг 1 визарда) подгружается ЗАРАНЕЕ,
  // до открытия шторки — иначе шторка сразу появлялась бы пустой и
  // "прыгала" по высоте через мгновение, когда список внутри неё подгрузится
  // (тот же список LogUsageWizard запросил бы сам при монтировании). Пока
  // грузится — спиннер прямо на кнопке "Списать пряжу", шторка не
  // открывается вообще.
  const [isPreparingLogUsage, setIsPreparingLogUsage] = useState(false);
  const [logUsageInitialProjects, setLogUsageInitialProjects] = useState<ProjectListItem[]>([]);

  const handleOpenLogUsage = async () => {
    if (isPreparingLogUsage) return;
    setIsPreparingLogUsage(true);
    try {
      const res = await fetchProjects({});
      setLogUsageInitialProjects(res.items);
    } catch (err) {
      console.error('[StashSkeinDetails] prefetch projects for usage wizard failed:', err);
      setLogUsageInitialProjects([]);
    } finally {
      setIsPreparingLogUsage(false);
      setIsLogUsageOpen(true);
    }
  };
  const [openSwipeUsageId, setOpenSwipeUsageId] = useState<string | null>(null);
  const [deleteUsageTarget, setDeleteUsageTarget] = useState<StashUsage | null>(null);
  const [isDeletingUsage, setIsDeletingUsage] = useState(false);
  const [editUsageTarget, setEditUsageTarget] = useState<StashUsage | null>(null);
  // EditUsageModal остаётся смонтированной во время анимации закрытия
  // (useSheetTransition), поэтому usage для неё берём из ПОСЛЕДНЕГО
  // ненулевого значения editUsageTarget, а не из самого editUsageTarget —
  // обнуление на close иначе унесло бы с собой usage раньше, чем шторка
  // успеет доиграть выезд вниз (тот же паттерн, что был бы нужен и для
  // условного рендера по editUsageTarget && <..>, только без размонтирования).
  const [lastEditUsage, setLastEditUsage] = useState<StashUsage | null>(null);
  const [openSwipeSwatchId, setOpenSwipeSwatchId] = useState<string | null>(null);
  const [deleteSwatchTarget, setDeleteSwatchTarget] = useState<StashSwatch | null>(null);
  const [isDeletingSwatch, setIsDeletingSwatch] = useState(false);
  const [editSwatchTarget, setEditSwatchTarget] = useState<StashSwatch | null>(null);
  // Тот же паттерн, что lastEditUsage выше — EditSwatchModal должна
  // оставаться смонтированной во время анимации закрытия.
  const [lastEditSwatch, setLastEditSwatch] = useState<StashSwatch | null>(null);
  // Сворачиваемые блоки — ТОЛЬКО десктоп (Figma node-id=1659:22930, шевроны
  // у "Пряжа"/"Заметки"/"Образец"): на мобиле этих блоков сейчас нет вообще
  // (всегда развёрнуты, без шеврона), трогать мобильную вёрстку нельзя,
  // поэтому CollapsibleSection ниже рендерится только при isDesktop. Тот же
  // паттерн персистентности, что в ProjectDetails.tsx (openSections/
  // isSectionOpen/toggleSection, localStorage на id).
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!id) return;
    try {
      const raw = localStorage.getItem(`stash-skein-sections-${id}`);
      setOpenSections(raw ? JSON.parse(raw) : {});
    } catch {
      setOpenSections({});
    }
  }, [id]);

  const isSectionOpen = (key: string) => openSections[key] !== false;

  const toggleSection = (key: string) => {
    if (!id) return;
    setOpenSections((prev) => {
      const next = { ...prev, [key]: !isSectionOpen(key) };
      try {
        localStorage.setItem(`stash-skein-sections-${id}`, JSON.stringify(next));
      } catch {
        // Приватный режим/квота — секция всё равно переключится в этом рендере.
      }
      return next;
    });
  };
  const [matchesLocked, setMatchesLocked] = useState(false);
  const [matchesHasMore, setMatchesHasMore] = useState(false);
  const [isLoadingMoreMatches, setIsLoadingMoreMatches] = useState(false);
  const [isMatchesPaywallOpen, setIsMatchesPaywallOpen] = useState(false);
  const [isYarnFixFormOpen, setIsYarnFixFormOpen] = useState(false);
  const [yarnFixMPer100g, setYarnFixMPer100g] = useState('');
  const [yarnFixComposition, setYarnFixComposition] = useState('');
  const [isSubmittingYarnFix, setIsSubmittingYarnFix] = useState(false);
  const [yarnFixError, setYarnFixError] = useState<string | null>(null);
  const [isDeleteSkeinOpen, setIsDeleteSkeinOpen] = useState(false);
  const [isDeletingSkein, setIsDeletingSkein] = useState(false);

  // Заметка — всегда на странице, с автосохранением (тот же приём, что
  // ProjectDetails.tsx). noteText — локальная копия, не skein.note
  // напрямую: иначе каждый keystroke пришлось бы гонять через setSkein
  // (весь объект мотка) ради одного поля. EditSkeinModal.tsx своего поля
  // "Заметки" больше не имеет — правка только здесь, единственный источник.
  const [noteText, setNoteText] = useState('');
  const [noteSkeinId, setNoteSkeinId] = useState<string | null>(null);
  // textarea не может отрендерить кликабельную ссылку — по умолчанию
  // заметка показывается как текст с ссылками (renderNoteWithLinks),
  // textarea появляется только пока её редактируют.
  const [isEditingNote, setIsEditingNote] = useState(false);

  // Горизонтальный скролл блока "Что можно связать из этой пряжи" — ref на
  // сам скроллящийся контейнер (не отдельные карточки), нужен и для
  // сохранения scrollLeft перед переходом в описание (см. onClick карточки
  // ниже), и для восстановления после возврата (см. useLayoutEffect ниже).
  const matchesListRef = useRef<HTMLDivElement>(null);
  // Восстанавливаем скролл только из ПЕРВОГО вызова load() за жизнь
  // компонента (монтирование страницы) — иначе повторные load() после
  // редактирования образца/списания приняли бы старый sessionStorage-ключ
  // за новую команду восстановления и задёргали бы скролл.
  const matchesRestoreAttemptedRef = useRef(false);
  // Значение, которое нужно применить к scrollLeft, когда matches
  // (догруженные до нужного количества) наконец попадут в DOM — сам set
  // происходит в useLayoutEffect по matches, а не здесь, потому что здесь
  // ещё нет актуального matchesListRef.current.scrollWidth.
  const pendingMatchesScrollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [skeinData, matchesResult] = await Promise.all([
        fetchStashSkeinById(id),
        fetchStashMatches(id).catch((err) => {
          console.error('[StashSkeinDetails] fetchStashMatches failed:', err);
          return { items: [], isLocked: false, hasMore: false };
        }),
      ]);
      setSkein(skeinData);

      let items = matchesResult.items;
      let hasMore = matchesResult.hasMore;

      if (!matchesRestoreAttemptedRef.current) {
        matchesRestoreAttemptedRef.current = true;
        const savedRaw = sessionStorage.getItem(`stash_matches_scroll_${id}`);
        if (savedRaw) {
          try {
            const saved: { count: number; scrollLeft: number } = JSON.parse(savedRaw);
            // Догружаем те же страницы, что были подгружены до перехода в
            // описание, одним заходом здесь — иначе scrollLeft пришлось бы
            // выставлять раньше, чем в контейнере есть что скроллить.
            while (items.length < saved.count && hasMore) {
              const more = await fetchStashMatches(id, items.length);
              items = [...items, ...more.items];
              hasMore = more.hasMore;
            }
            pendingMatchesScrollRef.current = saved.scrollLeft;
          } catch {
            sessionStorage.removeItem(`stash_matches_scroll_${id}`);
          }
        }
      }

      setMatches(items);
      setMatchesLocked(matchesResult.isLocked);
      setMatchesHasMore(hasMore);
    } catch (err) {
      console.error('[StashSkeinDetails] load failed:', err);
      setError('Не удалось загрузить карточку пряжи.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Применяем отложенный scrollLeft, как только восстановленные карточки
  // закоммитились в DOM — useLayoutEffect, а не useEffect, чтобы не было
  // видимого кадра со скроллом от нуля.
  useLayoutEffect(() => {
    if (pendingMatchesScrollRef.current == null) return;
    const container = matchesListRef.current;
    if (!container) return;
    container.scrollLeft = pendingMatchesScrollRef.current;
    pendingMatchesScrollRef.current = null;
    if (id) sessionStorage.removeItem(`stash_matches_scroll_${id}`);
  }, [matches, id]);

  useEffect(() => { load(); }, [load]);

  // Синхронизация noteText из skein.note — только при смене мотка (id), не
  // при каждом обновлении skein целиком: иначе автосохранение ниже (которое
  // само вызывает setSkein после успешного PATCH) сбивало бы курсор/
  // незасинканные keystrokes пользователя. Тот же приём, что в
  // ProjectDetails.tsx.
  useEffect(() => {
    if (!skein) return;
    if (noteSkeinId === skein.id) return;
    setNoteText(skein.note ?? '');
    setNoteSkeinId(skein.id);
  }, [skein, noteSkeinId]);

  // Автосохранение заметок — debounce, без кнопки "Сохранить". Пропускает
  // самый первый рендер после синхронизации выше (noteText только что
  // выставлен ИЗ skein.note, сохранять в бэкенд нечего) и повторное
  // сохранение уже совпадающего значения.
  useEffect(() => {
    if (!skein || noteSkeinId !== skein.id) return;
    if (noteText === (skein.note ?? '')) return;
    const timer = setTimeout(() => {
      // Бэкенд (updateSkein) сам приводит пустую строку к null в БД
      // ("note" in body ? body.note ? String(...) : null), в отличие от
      // updateProject, который сам требует string | null — тип здесь просто
      // string, отправляем как есть.
      updateStashSkein(skein.id, { note: noteText.trim() })
        .then((updated) => setSkein((prev) => prev && { ...prev, ...updated }))
        .catch((err) => {
          // Пользователю молча — следующая правка текста или уход со
          // страницы и возврат обратно синхронизирует noteText из
          // актуального skein.note; настойчивый ретрай здесь избыточен для
          // заметок. Лог оставляем — при повторяющихся сбоях PATCH нужно
          // это видеть, не дожидаясь жалобы "заметка не сохранилась".
          console.error('[StashSkeinDetails] note autosave failed:', err);
        });
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteText]);

  // Автодогрузка по скроллу (без кнопки "показать ещё") — первая страница
  // (20 карточек) уже пришла через load() выше, дальше по 10 за раз, пока
  // observerRef ниже не увидит последнюю карточку во вьюпорте.
  const loadMoreMatches = useCallback(async () => {
    if (!id || isLoadingMoreMatches || !matchesHasMore) return;
    setIsLoadingMoreMatches(true);
    try {
      const result = await fetchStashMatches(id, matches.length);
      setMatches((prev) => [...prev, ...result.items]);
      setMatchesHasMore(result.hasMore);
    } catch (err) {
      // Тихо для пользователя — это доп. страница, не критично для уже
      // открытой карточки; observer попробует снова, если карточка всё
      // ещё видна. Лог оставляем, чтобы видеть повторяющиеся сбои.
      console.error('[StashSkeinDetails] loadMoreMatches failed:', err);
    } finally {
      setIsLoadingMoreMatches(false);
    }
  }, [id, matches.length, isLoadingMoreMatches, matchesHasMore]);

  const matchesObserverRef = useRef<IntersectionObserver | null>(null);
  const lastMatchElementRef = useCallback((node: HTMLButtonElement | null) => {
    if (isLoadingMoreMatches) return;
    if (matchesObserverRef.current) matchesObserverRef.current.disconnect();

    matchesObserverRef.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && matchesHasMore) {
        loadMoreMatches();
      }
    });

    if (node) matchesObserverRef.current.observe(node);
  }, [isLoadingMoreMatches, matchesHasMore, loadMoreMatches]);

  const handleBack = () => {
    if (canGoBackInApp()) navigate(-1);
    else navigate('/stash');
  };

  const handleConfirmDeleteUsage = async () => {
    if (!deleteUsageTarget || isDeletingUsage) return;
    setIsDeletingUsage(true);
    try {
      await undoStashUsage(deleteUsageTarget.id);
      const removedAmount = deleteUsageTarget.amountG;
      // Точечное обновление вместо load() — полная перезагрузка страницы
      // (setLoading(true) → короткий возврат к "Загрузка...") здесь не нужна:
      // сервер уже атомарно вернул amountG в currentWeightG (undoUsage),
      // остаётся лишь отразить тот же результат локально.
      setSkein((prev) => prev && {
        ...prev,
        currentWeightG: prev.currentWeightG + removedAmount,
        usages: prev.usages.filter((u) => u.id !== deleteUsageTarget.id),
      });
      setDeleteUsageTarget(null);
      setOpenSwipeUsageId(null);
    } catch (err) {
      console.error('[StashSkeinDetails] handleConfirmDeleteUsage failed:', err);
      setError('Не удалось отменить списание. Попробуйте ещё раз.');
    } finally {
      setIsDeletingUsage(false);
    }
  };

  const handleConfirmDeleteSwatch = async () => {
    if (!deleteSwatchTarget || isDeletingSwatch) return;
    setIsDeletingSwatch(true);
    try {
      await deleteStashSwatch(deleteSwatchTarget.id);
      setSkein((prev) => prev && {
        ...prev,
        swatches: prev.swatches.filter((s) => s.id !== deleteSwatchTarget.id),
      });
      setDeleteSwatchTarget(null);
      setOpenSwipeSwatchId(null);
    } catch (err) {
      console.error('[StashSkeinDetails] handleConfirmDeleteSwatch failed:', err);
      setError('Не удалось удалить образец. Попробуйте ещё раз.');
    } finally {
      setIsDeletingSwatch(false);
    }
  };

  const handleConfirmDeleteSkein = async () => {
    if (!skein || isDeletingSkein) return;
    setIsDeletingSkein(true);
    try {
      await deleteStashSkein(skein.id);
      navigate('/stash');
    } catch (err) {
      console.error('[StashSkeinDetails] handleConfirmDeleteSkein failed:', err);
      setError('Не удалось удалить пряжу. Попробуйте ещё раз.');
      setIsDeletingSkein(false);
    }
  };

  const handleSubmitYarnFix = async () => {
    if (!skein || isSubmittingYarnFix) return;
    const mPer100gValue = yarnFixMPer100g.trim() ? Number(yarnFixMPer100g) : undefined;
    const compositionValue = yarnFixComposition.trim() || undefined;
    if (mPer100gValue === undefined && compositionValue === undefined) {
      setYarnFixError('Укажите хотя бы одно значение');
      return;
    }
    setIsSubmittingYarnFix(true);
    setYarnFixError(null);
    try {
      await suggestYarnFields(skein.id, { mPer100g: mPer100gValue, composition: compositionValue });
      // Бэкенд сразу пишет значение в snapshot этого мотка (видно владельцу
      // немедленно, независимо от решения модератора по справочнику) —
      // перезагружаем карточку, чтобы отразить и снапшот, и статус заявки,
      // точечный патч по одному полю здесь избыточен.
      setIsYarnFixFormOpen(false);
      await load();
    } catch (err) {
      console.error('[StashSkeinDetails] handleSubmitYarnFix failed:', err);
      setYarnFixError(err instanceof Error ? err.message : 'Не удалось отправить заявку');
    } finally {
      setIsSubmittingYarnFix(false);
    }
  };

  if (loading) {
    return <p className="loading-message">Загрузка...</p>;
  }

  if (error || !skein) {
    return (
      <div className="stash-details-container">
        <button className="back-button" onClick={handleBack}>
          <img src={arrowLeftIcon} alt="Back" className="back-button-icon" />
          Назад
        </button>
        <p className="stash-details-error">{error || 'Пряжа не найдена'}</p>
      </div>
    );
  }

  const remainderPercent = skein.totalWeightG > 0
    ? Math.round((skein.currentWeightG / skein.totalWeightG) * 100)
    : 0;

  // Общий контент для обеих веток (мобиле/десктоп) ниже — тот же JSX, что
  // раньше был инлайн, вынесен в переменные только чтобы не дублировать
  // текст буквально в isDesktop-ветке. На мобильный рендер не влияет.
  const yarnInfoRows = (
    <>
      {skein.brandSnapshot && <p className="stash-details-row"><b>Бренд:</b> {skein.brandSnapshot}</p>}
      {skein.compositionSnapshot && <p className="stash-details-row"><b>Состав:</b> {skein.compositionSnapshot}</p>}
      {skein.mPer100gSnapshot != null && <p className="stash-details-row"><b>Метраж:</b> {skein.mPer100gSnapshot} м/100г</p>}
      {skein.colorName && <p className="stash-details-row"><b>Цвет:</b> {skein.colorName}</p>}
      {skein.dyelot && <p className="stash-details-row"><b>Партия:</b> {skein.dyelot}</p>}
    </>
  );

  const remainderBlock = (
    <div className="stash-details-remainder">
      <p className="stash-details-row"><b>Остаток:</b> {skein.currentWeightG} г из {skein.totalWeightG} г</p>
      <div className="stash-progress-bar">
        <div className="stash-progress-fill" style={{ width: `${remainderPercent}%` }} />
      </div>
    </div>
  );

  // Заявка на дозаполнение обновляет snapshot этого мотка сразу (см.
  // suggestYarnFields на бэкенде) — статус модерации в общий справочник
  // пользователю не показываем: он не влияет на то, что тот видит и может
  // делать дальше. Поле считается "пустым к дозаполнению" только пока у
  // него нет значения ВООБЩЕ (снапшот всё ещё null) — как только заявка
  // отправлена, снапшот заполняется и этот блок для него сам перестаёт
  // рендериться.
  const yarnFixBlock = (() => {
    const needsMPer100g = skein.mPer100gSnapshot == null;
    const needsComposition = skein.compositionSnapshot == null;
    if (!needsMPer100g && !needsComposition) return null;

    return (
      <div className="stash-details-yarn-fix">
        {
          isYarnFixFormOpen ? (
            <div className="stash-details-yarn-fix-form">
              <p className="stash-details-section-title">Дозаполнить данные пряжи</p>
              <p className="stash-details-yarn-fix-hint">
                В справочнике не хватает части данных об этом артикуле — если знаете точные значения, предложите их. Значение появится у вас сразу, в общий справочник попадёт после проверки модератором.
              </p>
              {needsMPer100g && (
                <div className="stash-details-yarn-fix-field">
                  <label className="stash-details-yarn-fix-label">Метраж, м/100г</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    className="stash-details-yarn-fix-input"
                    value={yarnFixMPer100g}
                    onChange={(e) => setYarnFixMPer100g(e.target.value)}
                    placeholder="Например, 240"
                  />
                </div>
              )}
              {needsComposition && (
                <div className="stash-details-yarn-fix-field">
                  <label className="stash-details-yarn-fix-label">Состав</label>
                  <input
                    type="text"
                    className="stash-details-yarn-fix-input"
                    value={yarnFixComposition}
                    onChange={(e) => setYarnFixComposition(e.target.value)}
                    placeholder="Например, 50% шерсть, 50% акрил"
                  />
                </div>
              )}
              {yarnFixError && <p className="stash-details-yarn-fix-error">{yarnFixError}</p>}
              <div className="stash-details-yarn-fix-actions">
                <button
                  type="button"
                  className="btn stash-action-btn stash-action-btn--primary"
                  onClick={handleSubmitYarnFix}
                  disabled={isSubmittingYarnFix}
                >
                  {isSubmittingYarnFix ? 'Отправка...' : 'Отправить на проверку'}
                </button>
                <button
                  type="button"
                  className="btn stash-action-btn stash-action-btn--secondary"
                  onClick={() => { setIsYarnFixFormOpen(false); setYarnFixError(null); }}
                  disabled={isSubmittingYarnFix}
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="stash-details-yarn-fix-button" onClick={() => setIsYarnFixFormOpen(true)}>
              Дозаполнить данные пряжи
            </button>
          )
        }
      </div>
    );
  })();

  // Контент карточки (фото+текстовые строки) — общий для свайп-варианта
  // (мобиле) и варианта с кнопкой "..." (десктоп, см. ниже), различается
  // только интерактивная обёртка вокруг него.
  const renderSwatchContent = (swatch: StashSwatch) => (
    <>
      <div className="stash-swatch-image">
        {swatch.images.length > 0 ? (
          <StashImageCarousel images={swatch.images} alt="Образец" classPrefix="stash-swatch-image" />
        ) : (
          <div className="stash-swatch-image-placeholder">
            <img src={swatchPlaceholder} alt="" />
          </div>
        )}
      </div>
      <div className="stash-swatch-body">
        {swatch.needleSizeRaw && (
          <p className="stash-details-row">
            <b>
              {swatch.instrumentType === 'hook' ? 'Крючок:' : swatch.instrumentType === 'needle' ? 'Спицы:' : swatch.instrumentType === 'machine' ? 'Вязальная машина:' : 'Инструмент:'}
            </b>
            {' '}{swatch.needleSizeRaw}
          </p>
        )}
        {/* Было без ветки для 'machine' (и без явного default) — любой
            инструмент, кроме 'hook', молча подписывался "Спицы". */}
        {!swatch.needleSizeRaw && swatch.instrumentType && (
          <p className="stash-details-row">
            <b>{swatch.instrumentType === 'hook' ? 'Крючок' : swatch.instrumentType === 'machine' ? 'Вязальная машина' : 'Спицы'}</b>
          </p>
        )}
        {swatch.strandsCount != null && <p className="stash-details-row"><b>Количество нитей:</b> {swatch.strandsCount}</p>}
        {(swatch.densityStitchesBefore || swatch.densityRowsBefore) && (
          <p className="stash-details-row">
            <b>До ВТО:</b> {swatch.densityStitchesBefore ?? '—'} п. х {swatch.densityRowsBefore ?? '—'} р.
          </p>
        )}
        {(swatch.densityStitchesAfter || swatch.densityRowsAfter) && (
          <p className="stash-details-row">
            <b>После ВТО:</b> {swatch.densityStitchesAfter ?? '—'} п. х {swatch.densityRowsAfter ?? '—'} р.
          </p>
        )}
        {swatch.note && <p className="stash-details-row stash-swatch-note">{swatch.note}</p>}
      </div>
    </>
  );

  const swatchesInner = (
    <>
      {skein.swatches.map((swatch) => (
        <SwipeToDelete
          key={swatch.id}
          isOpen={openSwipeSwatchId === swatch.id}
          onSwipeOpen={() => setOpenSwipeSwatchId(swatch.id)}
          onSwipeClose={() => setOpenSwipeSwatchId((cur) => (cur === swatch.id ? null : cur))}
          onTap={() => { }}
          onRequestDelete={() => setDeleteSwatchTarget(swatch)}
          onRequestEdit={() => { setEditSwatchTarget(swatch); setLastEditSwatch(swatch); }}
          cardClassName="stash-swatch-block"
        >
          {renderSwatchContent(swatch)}
        </SwipeToDelete>
      ))}
      <button type="button" className="stash-add-button" onClick={() => setIsAddSwatchOpen(true)}>
        <Plus size={32} strokeWidth={1} className="stash-add-button-plus" />
        Добавить образец
      </button>
    </>
  );

  // Десктоп (без свайп-жеста — "..." открывает Редактировать/Удалить, тот
  // же HeaderActionsMenu, что в шапке карточки).
  const swatchesInnerDesktop = (
    <>
      {skein.swatches.map((swatch) => (
        <div key={swatch.id} className="stash-swatch-block stash-swatch-block--desktop">
          {renderSwatchContent(swatch)}
          <HeaderActionsMenu
            onEdit={() => { setEditSwatchTarget(swatch); setLastEditSwatch(swatch); }}
            onDelete={() => setDeleteSwatchTarget(swatch)}
          />
        </div>
      ))}
      <button type="button" className="stash-add-button" onClick={() => setIsAddSwatchOpen(true)}>
        <Plus size={32} strokeWidth={1} className="stash-add-button-plus" />
        Добавить образец
      </button>
    </>
  );

  // Та же логика показа/редактирования, что в ProjectDetails.tsx —
  // textarea не может отрендерить кликабельную ссылку, поэтому по
  // умолчанию показываем текст со ссылками, textarea только пока её
  // редактируют (клик по тексту/пустому месту, потеря фокуса — назад).
  const notesInner = isEditingNote || !noteText ? (
    <textarea
      className="stash-notes-textarea"
      value={noteText}
      onChange={(e) => setNoteText(e.target.value)}
      onBlur={() => setIsEditingNote(false)}
      placeholder="Быстрая заметка к мотку"
      rows={3}
      autoFocus={isEditingNote}
    />
  ) : (
    <p className="stash-notes-text stash-notes-text--editable" onClick={() => setIsEditingNote(true)}>
      {renderNoteWithLinks(noteText)}
    </p>
  );

  const renderUsageContent = (usage: StashUsage) => (
    <>
      <div className="stash-usage-image">
        {usage.finishedPhotos.length > 0 ? (
          <StashImageCarousel images={usage.finishedPhotos} alt={usage.projectTitle || 'Готовое изделие'} classPrefix="stash-usage-image" />
        ) : (
          <div className="stash-usage-image-placeholder">
            <img src={projectPlaceholder} alt="" />
          </div>
        )}
      </div>
      <div className="stash-usage-body">
        <p className="stash-usage-title">{usage.projectTitle || 'Без названия'}</p>
        {usage.patternAuthorSnapshot && (
          <p className="stash-usage-row"><b>Автор:</b> {usage.patternAuthorSnapshot}</p>
        )}
        {usage.patternTitleSnapshot && (
          <p className="stash-usage-row">
            <b>Описание:</b>{' '}
            {usage.patternTitleSnapshot}
          </p>
        )}
        <p className="stash-usage-row"><b>Расход:</b> {usage.amountG} г</p>
        {usage.needleSizeRaw && (
          <p className="stash-usage-row"><b>Спицы:</b> {usage.needleSizeRaw}</p>
        )}
      </div>
    </>
  );

  const handleUsageTap = (usage: StashUsage) => {
    // Приоритет: если списание пришло из "Проектов" — переход на карточку
    // проекта целиком, не на паттерн напрямую (PROJECTS_PLAN.md §4.6);
    // иначе прежнее поведение.
    if (usage.projectId) navigate(`/projects/${usage.projectId}`);
    else if (usage.patternId) navigate(`/pattern/${usage.patternId}`);
  };

  const usagesBlock = skein.usages.length > 0 ? (
    <div className="stash-details-usages">
      <p className="stash-details-section-title">Связано</p>
      {skein.usages.map((usage) => (
        <SwipeToDelete
          key={usage.id}
          isOpen={openSwipeUsageId === usage.id}
          onSwipeOpen={() => setOpenSwipeUsageId(usage.id)}
          onSwipeClose={() => setOpenSwipeUsageId((cur) => (cur === usage.id ? null : cur))}
          onTap={() => handleUsageTap(usage)}
          onRequestDelete={() => setDeleteUsageTarget(usage)}
          onRequestEdit={() => { setEditUsageTarget(usage); setLastEditUsage(usage); }}
          cardClassName="stash-usage-card"
        >
          {renderUsageContent(usage)}
        </SwipeToDelete>
      ))}
    </div>
  ) : null;

  // Десктоп — карточка кликабельна целиком (как и на мобиле, onTap), а
  // Редактировать/Удалить уходят под "...": stopPropagation на обёртке
  // меню, чтобы клик по нему не триггерил переход по карточке.
  const usagesBlockDesktop = skein.usages.length > 0 ? (
    <CollapsibleSection title="Связано" isOpen={isSectionOpen('usages')} onToggle={() => toggleSection('usages')} className="stash-details-usages">
      {skein.usages.map((usage) => (
        <div
          key={usage.id}
          className="stash-usage-card stash-usage-card--desktop"
          onClick={() => handleUsageTap(usage)}
        >
          {renderUsageContent(usage)}
          <div className="stash-usage-card-menu" onClick={(e) => e.stopPropagation()}>
            <HeaderActionsMenu
              onEdit={() => { setEditUsageTarget(usage); setLastEditUsage(usage); }}
              onDelete={() => setDeleteUsageTarget(usage)}
            />
          </div>
        </div>
      ))}
    </CollapsibleSection>
  ) : null;

  // "В процессе"/"В планах" — ниже "Связано". В отличие от usages (факт
  // списания), это проекты, у которых этот моток просто в материалах
  // (ProjectYarn), даже если по нему ещё ничего не списывали — см.
  // комментарий у linkedProjects в stashApi.ts/stashController.ts.
  // Тот же набор полей, что у "Связано" (renderUsageContent выше) —
  // Автор/Описание/Расход/Спицы, по просьбе пользователя одинаковый
  // список полей независимо от источника карточки. Без свайпа и
  // Редактировать/Удалить — это ссылка на проект, не редактируемая
  // запись мотка.
  const renderLinkedProjectCard = (p: StashSkeinDetail['linkedProjects'][number]) => (
    <button
      key={p.id}
      type="button"
      className="stash-usage-card"
      onClick={() => navigate(`/projects/${p.id}`)}
    >
      <div className="stash-usage-image">
        {p.coverUrl ? (
          <img src={p.coverUrl} alt="" className="stash-usage-image" />
        ) : (
          <div className="stash-usage-image-placeholder">
            <img src={projectPlaceholder} alt="" />
          </div>
        )}
      </div>
      <div className="stash-usage-body">
        <p className="stash-usage-title">{p.title}</p>
        {p.patternAuthorSnapshot && (
          <p className="stash-usage-row"><b>Автор:</b> {p.patternAuthorSnapshot}</p>
        )}
        {p.patternTitleSnapshot && (
          <p className="stash-usage-row"><b>Описание:</b> {p.patternTitleSnapshot}</p>
        )}
        {p.amountG != null && (
          <p className="stash-usage-row"><b>Расход:</b> {p.amountG} г</p>
        )}
        {p.instrumentsLabel && (
          <p className="stash-usage-row"><b>Инструмент:</b> {p.instrumentsLabel}</p>
        )}
      </div>
    </button>
  );

  // "В процессе" включает и PAUSED — пауза это всё ещё не завершённый
  // проект, пользователь попросил не заводить для неё отдельный блок.
  const makeLinkedProjectsBlock = (
    statuses: StashSkeinDetail['linkedProjects'][number]['status'][],
    title: string,
    sectionKey: string,
    desktop: boolean,
  ) => {
    const items = skein.linkedProjects.filter((p) => statuses.includes(p.status));
    if (items.length === 0) return null;
    const cards = items.map(renderLinkedProjectCard);
    return desktop ? (
      <CollapsibleSection title={title} isOpen={isSectionOpen(sectionKey)} onToggle={() => toggleSection(sectionKey)} className="stash-details-usages">
        {cards}
      </CollapsibleSection>
    ) : (
      <div className="stash-details-usages">
        <p className="stash-details-section-title">{title}</p>
        {cards}
      </div>
    );
  };

  const linkedInProgressBlock = makeLinkedProjectsBlock(['IN_PROGRESS', 'PAUSED'], STATUS_LABEL.IN_PROGRESS, 'linkedInProgress', false);
  const linkedPlannedBlock = makeLinkedProjectsBlock(['PLANNED'], STATUS_LABEL.PLANNED, 'linkedPlanned', false);
  const linkedInProgressBlockDesktop = makeLinkedProjectsBlock(['IN_PROGRESS', 'PAUSED'], STATUS_LABEL.IN_PROGRESS, 'linkedInProgress', true);
  const linkedPlannedBlockDesktop = makeLinkedProjectsBlock(['PLANNED'], STATUS_LABEL.PLANNED, 'linkedPlanned', true);

  const actionsBlock = (
    <div className="stash-details-actions">
      <button
        type="button"
        className="btn stash-action-btn stash-action-btn--primary"
        onClick={handleOpenLogUsage}
        disabled={skein.currentWeightG <= 0 || isPreparingLogUsage}
      >
        {isPreparingLogUsage ? <Loader2 size={18} strokeWidth={2} className="stash-action-btn-spinner" /> : 'Списать пряжу'}
      </button>
    </div>
  );

  return (
    <>
      <div className="stash-details-container">
        {isDesktop ? (
          <>
            <div className="stash-details-header">
              <p className="stash-breadcrumb">Пряжа / {skein.yarnNameSnapshot}</p>
              <div className="stash-details-desktop-actions">
                <button type="button" className="stash-details-desktop-edit" onClick={() => setIsEditOpen(true)}>
                  <SquarePen size={18} strokeWidth={1.5} />
                  Редактировать
                </button>
                <button type="button" className="stash-details-desktop-delete" onClick={() => setIsDeleteSkeinOpen(true)} aria-label="Удалить">
                  <Trash2 size={18} strokeWidth={1.5} />
                </button>
              </div>
            </div>

            <div className="stash-details-desktop-grid">
              <div className="stash-details-desktop-gallery">
                {skein.images.length > 0 ? (
                  <StashImageGalleryDesktop images={skein.images} alt={skein.yarnNameSnapshot} />
                ) : (
                  <div className="stash-gallery-desktop-main stash-gallery-desktop-main--placeholder">
                    <img src={yarnPlaceholder} alt="" />
                  </div>
                )}
                {remainderBlock}
                {actionsBlock}
                <CollapsibleSection title="Заметки" isOpen={isSectionOpen('notes')} onToggle={() => toggleSection('notes')} className="stash-details-notes">
                  {notesInner}
                </CollapsibleSection>
              </div>

              <div className="stash-details-desktop-info">
                <h1 className="stash-details-name">{skein.yarnNameSnapshot}</h1>

                <CollapsibleSection title="Пряжа" isOpen={isSectionOpen('yarn')} onToggle={() => toggleSection('yarn')} className="stash-details-info">
                  <p className="stash-details-row"><b>Артикул:</b> {skein.yarnNameSnapshot}</p>
                  {yarnInfoRows}
                </CollapsibleSection>

                {yarnFixBlock}
                {usagesBlockDesktop}
                {linkedInProgressBlockDesktop}
                {linkedPlannedBlockDesktop}
              </div>

              <div className="stash-details-desktop-swatches">
                <CollapsibleSection title="Образец" isOpen={isSectionOpen('swatch')} onToggle={() => toggleSection('swatch')} className="stash-details-swatches">
                  {swatchesInnerDesktop}
                </CollapsibleSection>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="stash-details-header">
              <button className="back-button" onClick={handleBack}>
                <img src={arrowLeftIcon} alt="Back" className="back-button-icon" />
                Назад
              </button>
              <HeaderActionsMenu onEdit={() => setIsEditOpen(true)} onDelete={() => setIsDeleteSkeinOpen(true)} />
            </div>

            <div className="stash-details-image-wrapper">
              <div className="stash-details-image-container">
                {skein.images.length > 0 ? (
                  <StashImageCarousel images={skein.images} alt={skein.yarnNameSnapshot} />
                ) : (
                  <div className="stash-details-image stash-details-image-placeholder">
                    <img src={yarnPlaceholder} alt="" />
                  </div>
                )}
              </div>
            </div>

            <div className="stash-details-info">
              <h1 className="stash-details-name">{skein.yarnNameSnapshot}</h1>
              {yarnInfoRows}
              {remainderBlock}
            </div>

            {yarnFixBlock}

            <div className="stash-details-swatches">
              <p className="stash-details-section-title">Образец</p>
              {swatchesInner}
            </div>

            <div className="stash-details-notes">
              <p className="stash-details-section-title">Заметки</p>
              {notesInner}
            </div>

            {usagesBlock}
            {linkedInProgressBlock}
            {linkedPlannedBlock}

            {actionsBlock}
          </>
        )}

        {matches.length > 0 && (
          <div className="stash-details-matches">
            <p className="stash-details-section-title">Что можно связать из этой пряжи</p>
            <div className="stash-matches-list" ref={matchesListRef}>
              {matches.map((m, i) => (
                <div key={m.id} className="stash-match-card-wrap">
                  <button
                    ref={i === matches.length - 1 ? lastMatchElementRef : undefined}
                    type="button"
                    className={`stash-match-card${matchesLocked ? ' stash-match-card--locked' : ''}`}
                    onClick={() => {
                      if (matchesLocked) { setIsMatchesPaywallOpen(true); return; }
                      // Сохраняем позицию ПЕРЕД переходом — после возврата
                      // страница монтируется заново (см. load() выше), восстановить
                      // scrollLeft можно только по тому, что успели записать здесь.
                      if (id && matchesListRef.current) {
                        sessionStorage.setItem(
                          `stash_matches_scroll_${id}`,
                          JSON.stringify({ count: matches.length, scrollLeft: matchesListRef.current.scrollLeft }),
                        );
                      }
                      navigate(`/pattern/${m.id}`);
                    }}
                  >
                    {matchesLocked ? (
                      <div className="stash-match-image-frame">
                        <img src={m.thumbnailUrl} alt="" loading="lazy" className="stash-match-image stash-match-image--locked" />
                        <Lock size={16} strokeWidth={1.5} className="stash-match-lock-icon" />
                      </div>
                    ) : (
                      <>
                        <img src={m.thumbnailUrl} alt="" loading="lazy" className="stash-match-image" />
                        <p className="stash-match-title">{m.title}</p>
                        <div className="stash-match-meta">
                          <p className="stash-match-category">{m.category ?? '—'}</p>
                          <p className="stash-match-instrument">{m.instruments[0] ?? '—'}</p>
                        </div>
                        {m.strandsCount != null && (
                          <p className="stash-match-strands">При вязании в {m.strandsCount} сложений</p>
                        )}
                      </>
                    )}
                  </button>
                  {/* Сердечко избранного — только десктоп (Figma node-id=1659:22930);
                    на мобильной карточке подбора его никогда не было. Вынесено
                    из .stash-match-card (это <button>) в соседнюю кнопку —
                    вложенные <button> внутри <button> невалидны. */}
                  {isDesktop && !matchesLocked && (
                    <button
                      type="button"
                      className="stash-match-favorite"
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(m.id); }}
                      aria-label={isFavorite(m.id) ? 'Убрать из избранного' : 'Добавить в избранное'}
                    >
                      <Heart size={20} strokeWidth={1.5} fill={isFavorite(m.id) ? '#ffffff' : 'none'} color="#ffffff" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* <Footer /> */}

        <AddSwatchModal
          isOpen={isAddSwatchOpen}
          skeinId={skein.id}
          onClose={() => setIsAddSwatchOpen(false)}
          onCreated={() => {
            setIsAddSwatchOpen(false);
            load();
          }}
        />

        {lastEditSwatch && (
          <EditSwatchModal
            isOpen={!!editSwatchTarget}
            swatch={lastEditSwatch}
            onClose={() => setEditSwatchTarget(null)}
            onSaved={() => {
              setEditSwatchTarget(null);
              load();
            }}
          />
        )}

        <EditSkeinModal
          isOpen={isEditOpen}
          skein={skein}
          onClose={() => setIsEditOpen(false)}
          onSaved={() => {
            setIsEditOpen(false);
            load();
          }}
        />

        <LogUsageWizard
          isOpen={isLogUsageOpen}
          skein={skein}
          initialProjects={logUsageInitialProjects}
          onClose={() => setIsLogUsageOpen(false)}
          onLogged={() => {
            setIsLogUsageOpen(false);
            load();
          }}
        />

        {lastEditUsage && (
          <EditUsageModal
            isOpen={!!editUsageTarget}
            skein={skein}
            usage={lastEditUsage}
            onClose={() => setEditUsageTarget(null)}
            onSaved={() => {
              setEditUsageTarget(null);
              load();
            }}
          />
        )}

        <DeleteConfirmModal
          isOpen={!!deleteUsageTarget}
          title="Отменить списание?"
          text={`«${deleteUsageTarget?.projectTitle || 'Без названия'}» — списанные ${deleteUsageTarget?.amountG ?? 0} г вернутся в остаток пряжи.`}
          isDeleting={isDeletingUsage}
          onCancel={() => setDeleteUsageTarget(null)}
          onConfirm={handleConfirmDeleteUsage}
        />

        <DeleteConfirmModal
          isOpen={!!deleteSwatchTarget}
          title="Удалить образец?"
          text="Образец будет удалён без возможности восстановить."
          isDeleting={isDeletingSwatch}
          onCancel={() => setDeleteSwatchTarget(null)}
          onConfirm={handleConfirmDeleteSwatch}
        />

        <DeleteConfirmModal
          isOpen={isDeleteSkeinOpen}
          title="Удалить пряжу?"
          text={`«${skein.yarnNameSnapshot}» будет удалена из хранилища без возможности восстановить.`}
          isDeleting={isDeletingSkein}
          onCancel={() => setIsDeleteSkeinOpen(false)}
          onConfirm={handleConfirmDeleteSkein}
        />

        <StashPaywallBanner
          isOpen={isMatchesPaywallOpen}
          reason="matches"
          freeLimit={10}
          onClose={() => setIsMatchesPaywallOpen(false)}
        />
      </div>
      <Footer />
    </>
  );
};
