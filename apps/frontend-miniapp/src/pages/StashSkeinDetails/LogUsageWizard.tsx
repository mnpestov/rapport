import React, { useEffect, useRef, useState } from 'react';
import { Plus, Lock, X } from 'lucide-react';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import {
  logStashUsage,
  logStashUsageForProject,
  fetchStashMatches,
  uploadStashImage,
  StashSkein,
  StashMatchItem,
} from '../../api/stashApi';
import { fetchPatterns, Pattern } from '../../api/patternsApi';
import {
  fetchProjects,
  fetchProjectById,
  updateProject,
  ProjectListItem,
  ProjectDetail,
} from '../../api/projectsApi';
import { STATUS_LABEL, STATUS_COLOR, STATUS_ICON } from '../Projects/projectStatus';
import { AddProjectModal } from '../Projects/AddProjectModal';
import { StashPaywallBanner } from '../../components/StashPaywallBanner/StashPaywallBanner';
import projectPlaceholder from '../../components/TabBar/icons/project1.svg';
import yarnPlaceholder from '../../assets/stash/yarn-placeholder.png';
import '../../styles/sheet.css';
import './LogUsageWizard.css';

const MAX_PHOTOS = 5;
const TOTAL_STEPS = 3;

// Общая форма карточки описания в вертикальном списке шага 2 — и подборка
// (StashMatchItem), и результаты поиска (Pattern) сводятся к ней.
interface RelatedPatternCard {
  id: string;
  title: string;
  thumbnailUrl: string;
  authorName: string;
  instruments: string[];
}

interface LogUsageWizardProps {
  isOpen: boolean;
  skein: StashSkein;
  onClose: () => void;
  onLogged: () => void;
  // Список "Выбрать из моих проектов" (шаг 1), подгруженный ДО открытия
  // шторки (StashSkeinDetails.tsx::handleOpenLogUsage) — чтобы шторка не
  // открывалась пустой с последующим "прыжком" высоты, когда список
  // подгрузится уже внутри неё. Пустой массив по умолчанию, не undefined —
  // эта же секция всё равно дозапрашивает актуальный список по вводу в
  // поиск, initialProjects только для самого первого рендера.
  initialProjects?: ProjectListItem[];
}

export const LogUsageWizard: React.FC<LogUsageWizardProps> = ({ isOpen, skein, onClose, onLogged, initialProjects }) => {
  const { isMounted, isVisible, sheetRef } = useSheetTransition(isOpen);
  const isDesktop = useIsDesktop();

  const [step, setStep] = useState(1);

  // Шаг 1 — проект (заменил собой прежний шаг "Описание": привязка к
  // проекту уже несёт в себе автора/описание/фото, спрашивать их отдельно
  // незачем). "Пропустить" открывает старый резервный путь — те же поля
  // поиска/ручного описания, что были шагом 2, просто теперь живут здесь
  // же, внутри шага 1, а не отдельным шагом (общее число шагов не растёт).
  const [selectedProject, setSelectedProject] = useState<ProjectDetail | null>(null);
  const [isProjectSkipped, setIsProjectSkipped] = useState(false);
  const [isAddProjectOpen, setIsAddProjectOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [projectResults, setProjectResults] = useState<ProjectListItem[]>([]);
  const [isSearchingProjects, setIsSearchingProjects] = useState(false);
  const projectDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  // true сразу после открытия, если пришли с готовым initialProjects — один
  // раз гасит самый первый (пустой-запрос) автофетч ниже, чтобы не долбить
  // сеть тем же списком сразу же повторно. Любой следующий ввод в поиск
  // срабатывает как обычно.
  const skipInitialProjectFetchRef = useRef(false);

  // Шаг 2 (было шагом 1, когда привязки к проекту ещё не было)
  const [amountG, setAmountG] = useState('');
  const [logAll, setLogAll] = useState(false);
  const [needleSizeRaw, setNeedleSizeRaw] = useState('');
  // Расход, уже записанный для пары (проект, моток) ДО открытия этого шага
  // — например, проект создан сразу завершённым прямо из этого визарда
  // (шаг 1, "Создать новый проект"), и там уже обязательно указали расход
  // (backdated-механика, PROJECTS_PLAN.md §0.3 п.2). Поле веса показывает
  // ИТОГОВУЮ сумму, не "ещё списать с нуля" — иначе повторный ввод того же
  // числа задваивал бы расход (logUsageForProject прибавляет ДЕЛЬТУ к уже
  // существующей StashUsage, не заменяет её, см. handleSubmit ниже).
  const [baselineAmountG, setBaselineAmountG] = useState(0);

  // Резервный путь "без проекта" (было отдельным шагом 2)
  const [projectTitle, setProjectTitle] = useState('');
  const [matches, setMatches] = useState<StashMatchItem[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Pattern[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // Поиск ограничен лимитом 10 за раз — total говорит, сколько всего
  // найдено, подгрузка по скроллу добирает остаток через offset, тот же
  // приём, что у Ravelry-подсказок в AddYarnModal.tsx.
  const [searchTotal, setSearchTotal] = useState(0);
  const [isLoadingMoreSearch, setIsLoadingMoreSearch] = useState(false);
  const searchResultsRef = useRef<HTMLDivElement>(null);
  const [selectedPattern, setSelectedPattern] = useState<{ id: string; title: string } | null>(null);
  const [isManualEntryOpen, setIsManualEntryOpen] = useState(false);
  const [manualAuthorName, setManualAuthorName] = useState('');
  const [manualDescriptionTitle, setManualDescriptionTitle] = useState('');
  const [isMatchesLocked, setIsMatchesLocked] = useState(false);
  const [isMatchesPaywallOpen, setIsMatchesPaywallOpen] = useState(false);
  const [isProjectLimitPaywallOpen, setIsProjectLimitPaywallOpen] = useState(false);

  // Шаг 3
  const [photos, setPhotos] = useState<string[]>([]);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  // Защита от гонки ответов — тот же приём, что в AddProjectModal.tsx.
  const searchSeqRef = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setSelectedProject(null);
    setIsProjectSkipped(false);
    setIsAddProjectOpen(false);
    setProjectQuery('');
    setProjectResults(initialProjects ?? []);
    skipInitialProjectFetchRef.current = !!initialProjects;
    setAmountG('');
    setLogAll(false);
    setBaselineAmountG(0);
    setNeedleSizeRaw('');
    setProjectTitle('');
    setMatches([]);
    setSearchQuery('');
    setSearchResults([]);
    setSelectedPattern(null);
    setIsManualEntryOpen(false);
    setManualAuthorName('');
    setManualDescriptionTitle('');
    setPhotos([]);
    setError(null);
    setIsProjectLimitPaywallOpen(false);
  }, [isOpen]);

  // Список "Выбрать из моих проектов" — сразу при входе на шаг 1 (как
  // "Выбрать пряжу из моих запасов" в AddProjectModal), поиск уточняет по
  // вводу. Не запускаем, если проект уже выбран или выбран резервный путь
  // "без проекта" — тогда этот блок просто не отображается.
  useEffect(() => {
    if (step !== 1 || !isOpen || selectedProject || isProjectSkipped) return;
    if (skipInitialProjectFetchRef.current && projectQuery.trim() === '') {
      // Уже пришли с готовым списком (см. initialProjects/StashSkeinDetails.
      // tsx::handleOpenLogUsage) — не повторяем тот же самый запрос сразу
      // же, как только шторка открылась.
      skipInitialProjectFetchRef.current = false;
      return;
    }
    if (projectDebounceRef.current) clearTimeout(projectDebounceRef.current);
    projectDebounceRef.current = setTimeout(async () => {
      setIsSearchingProjects(true);
      try {
        const res = await fetchProjects({ q: projectQuery.trim() || undefined });
        setProjectResults(res.items);
      } catch (err) {
        console.error('[LogUsageWizard] fetchProjects failed:', err);
        setProjectResults([]);
      } finally {
        setIsSearchingProjects(false);
      }
    }, 300);
    return () => { if (projectDebounceRef.current) clearTimeout(projectDebounceRef.current); };
  }, [step, isOpen, selectedProject, isProjectSkipped, projectQuery]);

  // Подборка описаний ("Что можно связать из этой пряжи") — только в
  // резервном пути без проекта (раньше это был отдельный шаг 2).
  useEffect(() => {
    if (step !== 1 || !isOpen || !isProjectSkipped) return;
    setMatchesLoading(true);
    fetchStashMatches(skein.id)
      .then((res) => { setMatches(res.items); setIsMatchesLocked(res.isLocked); })
      .catch((err) => {
        console.error('[LogUsageWizard] fetchStashMatches failed:', err);
        setMatches([]);
        setIsMatchesLocked(false);
      })
      .finally(() => setMatchesLoading(false));
  }, [step, isOpen, isProjectSkipped, skein.id]);

  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      setSearchTotal(0);
      return;
    }
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(async () => {
      const seq = ++searchSeqRef.current;
      setIsSearching(true);
      try {
        const res = await fetchPatterns({ search: searchQuery.trim(), limit: 10, titleAuthorOnly: true });
        if (seq !== searchSeqRef.current) return; // пришёл не последний ответ — игнорируем
        setSearchResults(res.data);
        setSearchTotal(res.total);
      } catch (err) {
        console.error('[LogUsageWizard] pattern search failed:', err);
        if (seq === searchSeqRef.current) { setSearchResults([]); setSearchTotal(0); }
      } finally {
        if (seq === searchSeqRef.current) setIsSearching(false);
      }
    }, 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchQuery]);

  // Подгрузка остатка найденного по скроллу — тот же приём, что в
  // AddProjectModal.tsx.
  const handleSearchResultsScroll = () => {
    const el = searchResultsRef.current;
    if (!el || isLoadingMoreSearch || searchResults.length >= searchTotal) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (!nearBottom) return;

    const seq = searchSeqRef.current;
    setIsLoadingMoreSearch(true);
    fetchPatterns({ search: searchQuery.trim(), limit: 10, offset: searchResults.length, titleAuthorOnly: true })
      .then((res) => {
        if (seq !== searchSeqRef.current) return;
        setSearchResults((prev) => [...prev, ...res.data]);
        setSearchTotal(res.total);
      })
      .catch((err) => {
        console.error('[LogUsageWizard] load more patterns failed:', err);
      })
      .finally(() => {
        if (seq === searchSeqRef.current) setIsLoadingMoreSearch(false);
      });
  };

  if (!isMounted) return null;

  const effectiveAmount = logAll ? skein.currentWeightG : Number(amountG) || 0;
  const remainderAfter = skein.currentWeightG - effectiveAmount;
  // Было isStep1Valid — вес теперь шаг 2 (шаг 1 занял выбор проекта).
  const isWeightValid = effectiveAmount > 0 && effectiveAmount <= skein.currentWeightG;
  const isProjectStepValid = !!selectedProject || isProjectSkipped;

  const handleAmountChange = (value: string) => {
    setAmountG(value);
    setLogAll(false);
  };

  const handleToggleLogAll = () => {
    setLogAll((prev) => {
      const next = !prev;
      if (next) setAmountG(String(skein.currentWeightG));
      return next;
    });
  };

  // Общий префилл после выбора/создания проекта — инструмент (если у
  // проекта ровно один, подставляем его размер, иначе оставляем поле
  // пустым для ручного ввода — у проекта может быть несколько
  // инструментов, а это списание относится к одному конкретному мотку) и
  // фото (список уже загруженных на проект — шаг 3 дополняет его, не
  // начинает заново, т.к. Project.finishedPhotos — единственное место
  // хранения для списаний с привязкой к проекту).
  const applyProjectPrefill = (project: ProjectDetail) => {
    setSelectedProject(project);
    setIsProjectSkipped(false);
    if (project.instruments.length === 1 && project.instruments[0].sizeMm != null) {
      setNeedleSizeRaw(String(project.instruments[0].sizeMm).replace('.', ','));
    }
    setPhotos(project.finishedPhotos);
    // Уже записанный расход по этому мотку в этом проекте (например, только
    // что указан в форме создания проекта сразу завершённым) — подставляем
    // как итог, не оставляем поле пустым, см. комментарий у baselineAmountG.
    const existingYarn = project.yarns.find((y) => y.skeinId === skein.id);
    const baseline = existingYarn?.amountAtCompletionG ?? 0;
    setBaselineAmountG(baseline);
    if (baseline > 0) {
      setAmountG(String(baseline));
      setLogAll(false);
    }
  };

  const handlePickProject = async (item: ProjectListItem) => {
    try {
      const full = await fetchProjectById(item.id);
      applyProjectPrefill(full);
    } catch (err) {
      console.error('[LogUsageWizard] fetchProjectById failed:', err);
      setError('Не удалось загрузить проект');
    }
  };

  const handleProjectCreated = (project: ProjectDetail) => {
    setIsAddProjectOpen(false);
    applyProjectPrefill(project);
  };

  const clearSelectedProject = () => {
    setSelectedProject(null);
    setNeedleSizeRaw('');
    setPhotos([]);
    setAmountG('');
    setLogAll(false);
    setBaselineAmountG(0);
  };

  const handlePickPattern = (id: string, title: string) => {
    setSelectedPattern((prev) => (prev?.id === id ? null : { id, title }));
    setIsManualEntryOpen(false);
  };

  const handleOpenManualEntry = () => {
    setSelectedPattern(null);
    setIsManualEntryOpen(true);
  };

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    const remainingSlots = MAX_PHOTOS - photos.length;
    if (remainingSlots <= 0) return;
    const toUpload = files.slice(0, remainingSlots);
    setIsUploadingPhoto(true);
    try {
      // Последовательно, не Promise.all — иначе конкурентные вызовы
      // uploadStashImage перегружают тот же multer-эндпоинт, что и остальные
      // формы хранилища, без выигрыша в UX (индикатор загрузки один общий).
      for (const file of toUpload) {
        const url = await uploadStashImage(file);
        setPhotos((prev) => [...prev, url]);
      }
    } catch (err) {
      console.error('[LogUsageWizard] photo upload failed:', err);
      setError(err instanceof Error ? err.message : 'Не удалось загрузить фото');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const removePhoto = (url: string) => setPhotos((prev) => prev.filter((u) => u !== url));

  const goNext = () => setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      if (selectedProject) {
        // logUsageForProject прибавляет ДЕЛЬТУ к уже существующему расходу
        // (не заменяет его) — если расход уже был (baselineAmountG, см.
        // applyProjectPrefill) и пользователь не увеличил сумму, слать
        // нечего (нулевая/отрицательная дельта означала бы повторное
        // списание того же самого расхода — ровно тот баг, который был).
        const deltaAmountG = effectiveAmount - baselineAmountG;
        if (deltaAmountG > 0) {
          await logStashUsageForProject(skein.id, {
            projectId: selectedProject.id,
            amountG: deltaAmountG,
            needleSizeRaw: needleSizeRaw.trim() || undefined,
          });
        }
        // Фото готового изделия для списаний с привязкой к проекту живут
        // на самом проекте (Project.finishedPhotos), не на StashUsage —
        // отдельный PATCH, только если список фото реально поменялся.
        const photosChanged = photos.length !== selectedProject.finishedPhotos.length
          || photos.some((url, i) => url !== selectedProject.finishedPhotos[i]);
        if (photosChanged) {
          await updateProject(selectedProject.id, { finishedPhotos: photos });
        }
      } else {
        await logStashUsage(skein.id, {
          amountG: effectiveAmount,
          needleSizeRaw: needleSizeRaw.trim() || undefined,
          projectTitle: projectTitle.trim() || undefined,
          patternId: selectedPattern?.id,
          manualAuthorName: !selectedPattern ? manualAuthorName.trim() || undefined : undefined,
          manualDescriptionTitle: !selectedPattern ? manualDescriptionTitle.trim() || undefined : undefined,
          finishedPhotos: photos,
        });
      }
      onLogged();
    } catch (err) {
      console.error('[LogUsageWizard] handleSubmit failed:', err);
      setError(err instanceof Error ? err.message : 'Не удалось списать пряжу');
    } finally {
      setIsSubmitting(false);
    }
  };

  const stepTitle = `Шаг ${step} из ${TOTAL_STEPS}`;

  // Подборка (StashMatchItem) показывается сразу, пока поиск пуст; как
  // только начат ввод — список заменяется результатами поиска (§10 плана:
  // подборка экономит набор текста в частом случае, поиск — запасной путь).
  const relatedCards: RelatedPatternCard[] = searchQuery.trim().length >= 2
    ? searchResults.map((p) => ({ id: p.id, title: p.title, thumbnailUrl: p.thumbnailUrl, authorName: p.author, instruments: p.instruments }))
    : matches.map((m) => ({ id: m.id, title: m.title, thumbnailUrl: m.thumbnailUrl, authorName: m.authorName, instruments: m.instruments }));
  const isShowingSearch = searchQuery.trim().length >= 2;
  const isRelatedLoading = isShowingSearch ? isSearching : matchesLoading;
  // Та же логика, что в EditUsageModal — описание уже привязано (выбран
  // паттерн или вручную введены автор/название), подсказки "Что можно
  // связать из этой пряжи" не нужны. Поле "Описание" остаётся доступным —
  // набор 2+ букв снова включает isShowingSearch и возвращает блок подсказок.
  const hasAttachedDescription = !isShowingSearch && (
    !!selectedPattern || (isManualEntryOpen && (manualAuthorName.trim() !== '' || manualDescriptionTitle.trim() !== ''))
  );

  return (
    <div ref={sheetRef} className={`log-usage-overlay sheet-overlay ${isVisible ? 'sheet-open' : ''}`} onClick={onClose}>
      <div className="log-usage-panel sheet-panel" onClick={(e) => e.stopPropagation()}>
        {isDesktop && (
          <>
            <button type="button" className="log-usage-desktop-close" onClick={onClose} aria-label="Закрыть">
              <X size={24} strokeWidth={1.5} />
            </button>
            <div className="log-usage-desktop-photo">
              <div className="log-usage-desktop-photo-main">
                <img src={skein.images[0] ?? yarnPlaceholder} alt="" />
              </div>
              <div className="log-usage-desktop-card">
                <p className="log-usage-desktop-card-title">{skein.yarnNameSnapshot}</p>
                {skein.brandSnapshot && <p className="log-usage-desktop-card-row"><b>Бренд:</b> {skein.brandSnapshot}</p>}
                {skein.compositionSnapshot && <p className="log-usage-desktop-card-row"><b>Состав:</b> {skein.compositionSnapshot}</p>}
                {skein.mPer100gSnapshot != null && <p className="log-usage-desktop-card-row"><b>Метраж:</b> {skein.mPer100gSnapshot}м/100г</p>}
              </div>
            </div>
          </>
        )}

        <div className="log-usage-header">
          {isDesktop ? (
            <div className="log-usage-desktop-title-row">
              <h2 className="log-usage-title">Списание пряжи</h2>
              <div className="log-usage-desktop-steps">
                <span className="log-usage-desktop-steps-label">{stepTitle}</span>
                <span className="log-usage-desktop-steps-bar">
                  {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                    <span key={i} className={`log-usage-desktop-steps-segment${i < step ? ' log-usage-desktop-steps-segment--filled' : ''}`} />
                  ))}
                </span>
              </div>
            </div>
          ) : (
            <>
              <p className="log-usage-step">{stepTitle}</p>
              <h2 className="log-usage-title">{skein.yarnNameSnapshot}</h2>
            </>
          )}
        </div>

        <div className="log-usage-body">
          {step === 1 && (
            <>
              {selectedProject ? (
                <div className="log-usage-field">
                  <p className="log-usage-section-title">Проект</p>
                  <div className="log-usage-card-row log-usage-card-row--selected">
                    <img
                      src={selectedProject.finishedPhotos[0] ?? selectedProject.images[0] ?? projectPlaceholder}
                      alt=""
                      className="log-usage-card-row-image"
                    />
                    <div className="log-usage-card-row-body">
                      <p className="log-usage-card-row-title">{selectedProject.title}</p>
                      {(() => {
                        const Icon = STATUS_ICON[selectedProject.status];
                        return (
                          <span className="status-badge" style={{ background: STATUS_COLOR[selectedProject.status] }}>
                            <span className="projects-status-icon-wrap">
                              <Icon size={13} strokeWidth={1.5} color="#ffffff" />
                            </span>
                            {STATUS_LABEL[selectedProject.status]}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                  <button type="button" className="log-usage-text-link-btn" onClick={clearSelectedProject}>
                    Сбросить выбор
                  </button>
                </div>
              ) : isProjectSkipped ? (
                <>
                  <button type="button" className="log-usage-text-link-btn" onClick={() => setIsProjectSkipped(false)}>
                    ← Назад к выбору проекта
                  </button>

                  <div className="log-usage-field">
                    <label className="log-usage-label">Название проекта</label>
                    <input
                      className="log-usage-input"
                      value={projectTitle}
                      placeholder="Введите название проекта"
                      onChange={(e) => setProjectTitle(e.target.value)}
                    />
                  </div>

                  <div className="log-usage-field">
                    <label className="log-usage-label">Описание</label>
                    <div className="log-usage-input-lock-wrap">
                      <input
                        className="log-usage-input"
                        value={searchQuery}
                        placeholder="Введите название или автора"
                        onChange={(e) => setSearchQuery(e.target.value)}
                        disabled={isMatchesLocked}
                        onFocus={() => { if (isMatchesLocked) setIsMatchesPaywallOpen(true); }}
                        readOnly={isMatchesLocked}
                      />
                      {isMatchesLocked && (
                        <button type="button" className="log-usage-input-lock" onClick={() => setIsMatchesPaywallOpen(true)} aria-label="Доступно с подпиской">
                          <Lock size={16} strokeWidth={1.5} />
                        </button>
                      )}
                    </div>
                  </div>

                  {selectedPattern && !isShowingSearch && (
                    <p className="log-usage-empty-text">Выбрано: {selectedPattern.title}</p>
                  )}

                  <div className="log-usage-related">
                    {!hasAttachedDescription && (
                      <>
                        <p className="log-usage-section-title">Что можно связать из этой пряжи</p>
                        {isMatchesLocked ? (
                          <button
                            type="button"
                            className="log-usage-manual-add-btn"
                            onClick={handleOpenManualEntry}
                          >
                            <Plus size={16} strokeWidth={1.5} />
                            Добавить вручную
                          </button>
                        ) : (
                          <>
                            {!isRelatedLoading && isShowingSearch && relatedCards.length === 0 && !isManualEntryOpen && (
                              <>
                                <p className="log-usage-empty-text">Ничего не найдено</p>
                                <button type="button" className="log-usage-manual-add-btn" onClick={handleOpenManualEntry}>
                                  <Plus size={16} strokeWidth={1.5} />
                                  Добавить вручную
                                </button>
                              </>
                            )}
                            {relatedCards.length > 0 && (
                              <div
                                className="log-usage-cards-vertical"
                                ref={isShowingSearch ? searchResultsRef : undefined}
                                onScroll={isShowingSearch ? handleSearchResultsScroll : undefined}
                              >
                                {relatedCards.map((p) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    className={`log-usage-card-row${selectedPattern?.id === p.id ? ' log-usage-card-row--selected' : ''}`}
                                    onClick={() => handlePickPattern(p.id, p.title)}
                                  >
                                    <img src={p.thumbnailUrl} alt="" className="log-usage-card-row-image" />
                                    <div className="log-usage-card-row-body">
                                      <p className="log-usage-card-row-title">{p.title}</p>
                                      <p className="log-usage-card-row-meta"><b>Автор:</b> {p.authorName}</p>
                                      {p.instruments.length > 0 && (
                                        <p className="log-usage-card-row-meta"><b>Инструмент:</b> {p.instruments.join(', ')}</p>
                                      )}
                                    </div>
                                  </button>
                                ))}
                                {/* Подгрузка — только для поиска (matches/
                                    "что можно связать" не пагинируется). */}
                                {isShowingSearch && isLoadingMoreSearch && <p className="log-usage-empty-text">Загрузка...</p>}
                              </div>
                            )}
                          </>
                        )}
                      </>
                    )}

                    {isManualEntryOpen && (
                      <div className="log-usage-manual-entry">
                        <div className="log-usage-field">
                          <label className="log-usage-label">Автор</label>
                          <input
                            className="log-usage-input"
                            value={manualAuthorName}
                            placeholder="Введите имя автора"
                            onChange={(e) => setManualAuthorName(e.target.value)}
                          />
                        </div>
                        <div className="log-usage-field">
                          <label className="log-usage-label">Описание</label>
                          <input
                            className="log-usage-input"
                            value={manualDescriptionTitle}
                            placeholder="Введите название проекта"
                            onChange={(e) => setManualDescriptionTitle(e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <button type="button" className="plus-add-button" onClick={() => setIsAddProjectOpen(true)}>
                    <Plus size={32} strokeWidth={1} className="plus-add-button-icon" />
                    Создать новый проект
                  </button>

                  <div className="log-usage-field">
                    <label className="log-usage-label">Выбрать из моих проектов</label>
                    <input
                      className="log-usage-input"
                      value={projectQuery}
                      placeholder="Найти среди своих проектов"
                      onChange={(e) => setProjectQuery(e.target.value)}
                    />
                  </div>

                  {!isSearchingProjects && projectResults.length === 0 && (
                    <p className="log-usage-empty-text">
                      {projectQuery.trim() ? 'Ничего не найдено' : 'Проектов пока нет'}
                    </p>
                  )}
                  {projectResults.length > 0 && (
                    <div className="log-usage-cards-vertical">
                      {projectResults.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className="log-usage-card-row"
                          onClick={() => handlePickProject(p)}
                        >
                          <img src={p.coverUrl ?? projectPlaceholder} alt="" className="log-usage-card-row-image" />
                          <div className="log-usage-card-row-body">
                            <p className="log-usage-card-row-title">{p.title}</p>
                            {(() => {
                              const Icon = STATUS_ICON[p.status];
                              return (
                                <span className="status-badge" style={{ background: STATUS_COLOR[p.status] }}>
                                  <span className="projects-status-icon-wrap">
                                    <Icon size={13} strokeWidth={1.5} color="#ffffff" />
                                  </span>
                                  {STATUS_LABEL[p.status]}
                                </span>
                              );
                            })()}
                            {p.instrumentNames.length > 0 && (
                              <p className="log-usage-card-row-meta"><b>Инструмент:</b> {p.instrumentNames.join(', ')}</p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div className="log-usage-remainder">
                <p className="log-usage-remainder-row"><b>Остаток:</b> <b>{skein.currentWeightG} г</b> из {skein.totalWeightG} г</p>
                <div className="stash-progress-bar">
                  <div
                    className="stash-progress-fill"
                    style={{ width: `${skein.totalWeightG > 0 ? (skein.currentWeightG / skein.totalWeightG) * 100 : 0}%` }}
                  />
                </div>
              </div>

              <div className="log-usage-field">
                <label className="log-usage-label">Укажите количество, которое хотите списать: *</label>
                <input
                  className="log-usage-input"
                  value={amountG}
                  placeholder="Вес в граммах"
                  inputMode="numeric"
                  onChange={(e) => handleAmountChange(e.target.value)}
                  disabled={logAll}
                />
              </div>

              <div className="log-usage-field">
                <label className="log-usage-label">Основной размер инструмента</label>
                <input
                  className="log-usage-input"
                  value={needleSizeRaw}
                  placeholder="Введите число"
                  onChange={(e) => setNeedleSizeRaw(e.target.value)}
                />
              </div>

              <label className="log-usage-checkbox-row">
                <input type="checkbox" checked={logAll} onChange={handleToggleLogAll} />
                <span>Списать пряжу полностью</span>
              </label>
              <p className="log-usage-checkbox-hint">{skein.currentWeightG} г из {skein.totalWeightG} г</p>

              {amountG && !logAll && Number(amountG) > skein.currentWeightG && (
                <p className="log-usage-error">Недостаточно пряжи: осталось {skein.currentWeightG} г</p>
              )}
              {isWeightValid && (
                <p className="log-usage-hint">Останется: {remainderAfter} г из {skein.totalWeightG} г</p>
              )}
            </>
          )}

          {step === 3 && (
            <div className="log-usage-field">
              <label className="log-usage-label">Фото готового изделия</label>
              <div className="log-usage-photos">
                {photos.map((url) => (
                  <div key={url} className="log-usage-photo-thumb">
                    <img src={url} alt="" />
                    <button type="button" className="log-usage-photo-remove" onClick={() => removePhoto(url)}>×</button>
                  </div>
                ))}
                {photos.length < MAX_PHOTOS && (
                  <button type="button" className="log-usage-photo-add" onClick={() => photoInputRef.current?.click()} disabled={isUploadingPhoto}>
                    +
                  </button>
                )}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handlePhotoSelected}
                />
              </div>
              <p className="log-usage-photo-hint">Первое фото — обложка.</p>
            </div>
          )}

          {error && <p className="log-usage-error">{error}</p>}
        </div>

        <div className="log-usage-footer">
          {step < TOTAL_STEPS ? (
            step === 1 && !isProjectStepValid ? (
              // Ни проект не выбран, ни резервный путь ещё не открыт —
              // кнопка не дизейблится, а становится "Пропустить": открывает
              // тот же резервный путь (поиск/ручной ввод описания), что
              // раньше была отдельная ссылка "Пропустить, без проекта".
              <button type="button" className="btn log-usage-next-btn" onClick={() => setIsProjectSkipped(true)}>
                Пропустить
              </button>
            ) : (
              <button
                type="button"
                className="btn log-usage-next-btn"
                onClick={goNext}
                disabled={step === 2 && !isWeightValid}
              >
                Далее
              </button>
            )
          ) : (
            <button type="button" className="btn log-usage-next-btn" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? 'Сохранение...' : 'Сохранить'}
            </button>
          )}
          <button type="button" className="btn log-usage-close-btn" onClick={step === 1 ? onClose : goBack} disabled={isSubmitting}>
            {step === 1 ? 'Закрыть' : 'Назад'}
          </button>
        </div>
      </div>

      <StashPaywallBanner
        isOpen={isMatchesPaywallOpen}
        reason="matches"
        freeLimit={10}
        onClose={() => setIsMatchesPaywallOpen(false)}
      />

      <AddProjectModal
        isOpen={isAddProjectOpen}
        onClose={() => setIsAddProjectOpen(false)}
        onCreated={handleProjectCreated}
        initialYarn={skein}
        onLimitReached={() => {
          setIsAddProjectOpen(false);
          setIsProjectLimitPaywallOpen(true);
        }}
      />

      <StashPaywallBanner
        isOpen={isProjectLimitPaywallOpen}
        reason="project-limit"
        freeLimit={5}
        onClose={() => setIsProjectLimitPaywallOpen(false)}
      />
    </div>
  );
};
