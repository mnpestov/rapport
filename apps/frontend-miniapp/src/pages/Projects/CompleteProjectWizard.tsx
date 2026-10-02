import React, { useEffect, useRef, useState } from 'react';
import { Plus, Check, SquareCheck, Square } from 'lucide-react';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import { completeProject, addProjectYarn, ProjectDetail, ProjectInstrumentInput, YarnUsageInput } from '../../api/projectsApi';
import { fetchPatterns, fetchFilters, Pattern, FilterOption } from '../../api/patternsApi';
import { fetchStashSkeins, uploadStashImage, StashSkein } from '../../api/stashApi';
import { AddYarnModal } from '../Stash/AddYarnModal';
import { StashPaywallBanner } from '../../components/StashPaywallBanner/StashPaywallBanner';

import '../../styles/sheet.css';
import '../StashSkeinDetails/LogUsageWizard.css';
import '../StashSkeinDetails/StashSkeinDetails.css';
import './AddProjectModal.css';

const MAX_PHOTOS = 5;

interface YarnAmountDraft {
  skeinId: string;
  yarnNameSnapshot: string;
  brandSnapshot: string | null;
  image: string | null;
  currentWeightG: number;
  totalWeightG: number;
  // Существующий расход, если проект уже завершался раньше и статус был
  // откачен назад (см. delta-guard на бэкенде, PROJECTS_PLAN.md §2.3) — при
  // повторном заполнении не как чистый лист, а как редактирование прежнего
  // значения.
  existingAmountG: number | null;
  amountG: string;
}

interface CompleteProjectWizardProps {
  isOpen: boolean;
  project: ProjectDetail;
  onClose: () => void;
  onCompleted: (project: ProjectDetail) => void;
}

// Логика "мягкого напоминания дозаполнить проект" при завершении
// (PROJECTS_PLAN.md, сверено с Figma node-id=1567:22683/22803/22951 —
// разные состояния шага 1 в зависимости от того, чего не хватает, и
// node-id=1454:17317 — шаг 2 "описание"):
//
// - Шаг 1 (материалы + инструмент) — ВСЕГДА показывается: расход пряжи
//   задним числом указывается именно здесь, его нельзя "уже заполнить"
//   заранее (в отличие от описания/фото). Инструмент — если уже выбран
//   ничего страшного, форма просто предзаполнена, чекбоксы остаются
//   редактируемыми (макет для "инструмент не выбран" отличается от
//   "инструмент уже указан" только заполненностью полей, не структурой).
// - Шаг 2 (описание) — ПРОПУСКАЕТСЯ, если на момент открытия визарда уже
//   заполнено (привязан паттерн или указаны manualAuthor+manualDescription
//   вручную) — единственный шаг, который может быть заранее полон.
// - Шаг 3 (фото готового изделия) — ВСЕГДА показывается, по явному решению
//   (не то же правило "пропускать если заполнено", что у шага 2).
//
// Никакого дробления шага 1 на подшаги (материалы отдельно, инструмент
// отдельно) — оба блока живут на одном экране одновременно.
export const CompleteProjectWizard: React.FC<CompleteProjectWizardProps> = ({ isOpen, project, onClose, onCompleted }) => {
  const { isMounted, isVisible, sheetRef } = useSheetTransition(isOpen);

  // "Логические" шаги, видимые пользователю в этом прохождении визарда —
  // вычисляются один раз при открытии (см. useEffect ниже), не пересчитываются
  // на лету, чтобы номер шага не прыгал, если пользователь сам заполнит
  // описание на шаге 1 и решит уйти вперёд (шаг 2 не обязан внезапно
  // появиться посреди прохождения).
  const [activeSteps, setActiveSteps] = useState<Array<1 | 2 | 3>>([1, 2, 3]);
  const [stepIndex, setStepIndex] = useState(0);
  const step = activeSteps[stepIndex] ?? 1;

  const [showSuccess, setShowSuccess] = useState(false);
  const [completedProject, setCompletedProject] = useState<ProjectDetail | null>(null);

  // Шаг 1 — расход по каждому привязанному мотку + инструмент(ы) проекта.
  const [yarnDrafts, setYarnDrafts] = useState<YarnAmountDraft[]>([]);
  // Поиск/привязка пряжи прямо на этом шаге, если к проекту ещё ничего не
  // привязано (Figma node-id=1567:22951) — тот же паттерн, что в
  // ProjectDetails.tsx: реальный addProjectYarn сразу (не черновик формы,
  // проект уже существует), локальное добавление в yarnDrafts вместо
  // полной перезагрузки всего проекта (не сбрасывать остальные поля шага).
  const [yarnQuery, setYarnQuery] = useState('');
  const [yarnResults, setYarnResults] = useState<StashSkein[]>([]);
  const [isSearchingYarn, setIsSearchingYarn] = useState(false);
  // Список запасов показывается уже по фокусу на поле, не дожидаясь ввода
  // первых символов — см. тот же паттерн в AddProjectModal.tsx.
  const [isYarnFieldFocused, setIsYarnFieldFocused] = useState(false);
  const [isAttachingYarn, setIsAttachingYarn] = useState(false);
  const [isAddYarnOpen, setIsAddYarnOpen] = useState(false);
  const [isYarnLimitPaywallOpen, setIsYarnLimitPaywallOpen] = useState(false);
  const yarnDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [instrumentOptions, setInstrumentOptions] = useState<FilterOption[]>([]);
  // Тот же формат, что AddProjectModal.tsx: ключ — instrumentId выбранного
  // инструмента, значение — сырая строка размера (мм).
  const [instrumentSizes, setInstrumentSizes] = useState<Record<string, string>>({});

  // Шаг 2 — описание, только если проект ещё не привязан ни к одному
  const hasPattern = project.patterns.length > 0;
  const [patternQuery, setPatternQuery] = useState('');
  const [patternResults, setPatternResults] = useState<Pattern[]>([]);
  const [isSearchingPattern, setIsSearchingPattern] = useState(false);
  const [selectedPattern, setSelectedPattern] = useState<{ id: string; title: string; author: string } | null>(null);
  const [isManualEntryOpen, setIsManualEntryOpen] = useState(false);
  const [manualAuthor, setManualAuthor] = useState('');
  const [manualDescription, setManualDescription] = useState('');

  // Шаг 3 — фото готового изделия
  const [finishedPhotos, setFinishedPhotos] = useState<string[]>([]);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const patternDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!isOpen) return;
    setYarnDrafts(
      project.yarns
        .filter((y) => y.skein)
        .map((y) => ({
          skeinId: y.skeinId as string,
          yarnNameSnapshot: y.skein!.yarnNameSnapshot,
          brandSnapshot: y.brandSnapshot,
          image: y.skein!.images[0] ?? null,
          currentWeightG: y.skein!.currentWeightG,
          totalWeightG: y.skein!.totalWeightG,
          existingAmountG: y.amountAtCompletionG,
          amountG: y.amountAtCompletionG != null ? String(y.amountAtCompletionG) : '',
        }))
    );
    setInstrumentSizes(
      Object.fromEntries(project.instruments.map((i) => [i.instrumentId, i.sizeMm != null ? String(i.sizeMm) : '']))
    );
    fetchFilters().then((res) => setInstrumentOptions(res.instruments)).catch(() => setInstrumentOptions([]));
    setYarnQuery('');
    setYarnResults([]);
    setIsAddYarnOpen(false);

    const descriptionAlreadyFilled = hasPattern || Boolean(project.manualAuthor && project.manualDescription);
    setActiveSteps(descriptionAlreadyFilled ? [1, 3] : [1, 2, 3]);
    setStepIndex(0);
    setShowSuccess(false);
    setCompletedProject(null);

    setPatternQuery('');
    setPatternResults([]);
    setSelectedPattern(null);
    setIsManualEntryOpen(false);
    setManualAuthor('');
    setManualDescription('');
    setFinishedPhotos(project.finishedPhotos);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, project]);

  useEffect(() => {
    if (patternQuery.trim().length < 2) {
      setPatternResults([]);
      return;
    }
    if (patternDebounceRef.current) clearTimeout(patternDebounceRef.current);
    patternDebounceRef.current = setTimeout(async () => {
      setIsSearchingPattern(true);
      try {
        const res = await fetchPatterns({ search: patternQuery.trim(), limit: 10 });
        setPatternResults(res.data);
      } catch (err) {
        console.error('[CompleteProjectWizard] pattern search failed:', err);
        setPatternResults([]);
      } finally {
        setIsSearchingPattern(false);
      }
    }, 300);
    return () => { if (patternDebounceRef.current) clearTimeout(patternDebounceRef.current); };
  }, [patternQuery]);

  useEffect(() => {
    if (!isYarnFieldFocused && yarnQuery.trim().length === 0) {
      setYarnResults([]);
      return;
    }
    if (yarnDebounceRef.current) clearTimeout(yarnDebounceRef.current);
    yarnDebounceRef.current = setTimeout(async () => {
      setIsSearchingYarn(true);
      try {
        const res = await fetchStashSkeins({ search: yarnQuery.trim() || undefined });
        setYarnResults(res.items);
      } catch (err) {
        console.error('[CompleteProjectWizard] yarn search failed:', err);
        setYarnResults([]);
      } finally {
        setIsSearchingYarn(false);
      }
    }, 300);
    return () => { if (yarnDebounceRef.current) clearTimeout(yarnDebounceRef.current); };
  }, [yarnQuery, isYarnFieldFocused]);

  if (!isMounted) return null;

  const updateYarnAmount = (skeinId: string, amountG: string) => {
    setYarnDrafts((prev) => prev.map((y) => (y.skeinId === skeinId ? { ...y, amountG } : y)));
  };

  // Привязывает моток к уже существующему проекту сразу (не черновик формы
  // — тот же путь, что и в ProjectDetails.tsx), затем добавляет его в
  // локальный yarnDrafts, а не перезагружает весь проект — иначе слетели
  // бы остальные несохранённые поля этого шага (инструмент, шаг 2/3).
  const handlePickYarn = async (skein: StashSkein) => {
    if (yarnDrafts.some((y) => y.skeinId === skein.id) || isAttachingYarn) return;
    setYarnQuery('');
    setYarnResults([]);
    setIsAttachingYarn(true);
    try {
      await addProjectYarn(project.id, skein.id);
      setYarnDrafts((prev) => [...prev, {
        skeinId: skein.id,
        yarnNameSnapshot: skein.yarnNameSnapshot,
        brandSnapshot: skein.brandSnapshot,
        image: skein.images[0] ?? null,
        currentWeightG: skein.currentWeightG,
        totalWeightG: skein.totalWeightG,
        existingAmountG: null,
        amountG: '',
      }]);
    } catch (err) {
      console.error('[CompleteProjectWizard] handlePickYarn failed:', err);
      setError(err instanceof Error ? err.message : 'Не удалось привязать пряжу');
    } finally {
      setIsAttachingYarn(false);
    }
  };

  // Пряжи не нашлось в хранилище по поиску — создаём новую прямо отсюда и
  // сразу привязываем к проекту, тем же путём, что и выбор из результатов
  // поиска (handlePickYarn).
  const handleYarnCreated = (skein: StashSkein) => {
    setIsAddYarnOpen(false);
    handlePickYarn(skein);
  };

  const toggleInstrument = (id: string) => {
    setInstrumentSizes((prev) => {
      if (id in prev) {
        const { [id]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: '' };
    });
  };

  const updateInstrumentSize = (id: string, size: string) => {
    setInstrumentSizes((prev) => ({ ...prev, [id]: size }));
  };

  const handlePickPattern = (p: Pattern) => {
    setSelectedPattern({ id: p.id, title: p.title, author: p.author });
    setIsManualEntryOpen(false);
    setPatternQuery('');
    setPatternResults([]);
  };

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    const remainingSlots = MAX_PHOTOS - finishedPhotos.length;
    if (remainingSlots <= 0) return;
    setIsUploadingPhoto(true);
    try {
      for (const file of files.slice(0, remainingSlots)) {
        const url = await uploadStashImage(file);
        setFinishedPhotos((prev) => [...prev, url]);
      }
    } catch (err) {
      console.error('[CompleteProjectWizard] photo upload failed:', err);
      setError(err instanceof Error ? err.message : 'Не удалось загрузить фото');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const removePhoto = (url: string) => setFinishedPhotos((prev) => prev.filter((u) => u !== url));

  // Каждое непустое поле должно быть корректной суммой в пределах остатка
  // мотка (delta-guard на бэкенде сам разрешает частичное совпадение со
  // старым значением — тут проверяем только то, что видит пользователь:
  // расход не может превышать физически имеющийся остаток + то, что уже
  // было списано этим же проектом).
  const isStep1Valid = yarnDrafts.every((y) => {
    if (y.amountG.trim() === '') return true;
    const amount = Number(y.amountG);
    const availableCeiling = y.currentWeightG + (y.existingAmountG ?? 0);
    return amount >= 0 && amount <= availableCeiling;
  });

  // instrumentSizes → payload: пустая строка размера — инструмент выбран,
  // но размер не указан (sizeMm: null), нечисловой ввод игнорируется как
  // ещё не завершённый (запятая вместо точки — обычный десятичный
  // разделитель в русской локали). Не useMemo — та же лёгкая пересборка на
  // каждый рендер, что и в AddProjectModal.tsx, не стоит мемоизации, а
  // здесь после early return (if (!isMounted)) вызов хука был бы нарушением
  // Rules of Hooks (см. историю бага — белый экран при первом открытии).
  const instrumentsPayload: ProjectInstrumentInput[] = Object.entries(instrumentSizes).map(([instrumentId, size]) => {
    const normalized = size.trim().replace(',', '.');
    const sizeMm = normalized === '' ? null : Number(normalized);
    return { instrumentId, sizeMm: sizeMm != null && Number.isFinite(sizeMm) ? sizeMm : null };
  });

  const isLastStep = stepIndex === activeSteps.length - 1;
  const goNext = () => setStepIndex((i) => Math.min(activeSteps.length - 1, i + 1));
  const goBack = () => setStepIndex((i) => Math.max(0, i - 1));

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const yarnUsages: YarnUsageInput[] = yarnDrafts
        .filter((y) => y.amountG.trim() !== '')
        .map((y) => ({ skeinId: y.skeinId, amountG: Number(y.amountG) }));
      const updated = await completeProject(project.id, {
        yarnUsages,
        instruments: instrumentsPayload,
        patternIds: selectedPattern ? [selectedPattern.id] : undefined,
        manualAuthor: !selectedPattern && !hasPattern ? manualAuthor.trim() || undefined : undefined,
        manualDescription: !selectedPattern && !hasPattern ? manualDescription.trim() || undefined : undefined,
        finishedPhotos,
      });
      // Не закрываем визард сразу — показываем экран успеха (Figma
      // node-id=1567:23008), onCompleted вызывается только по кнопке
      // "Закрыть" там, см. handleSuccessClose ниже.
      setCompletedProject(updated);
      setShowSuccess(true);
    } catch (err) {
      console.error('[CompleteProjectWizard] handleSubmit failed:', err);
      setError(err instanceof Error ? err.message : 'Не удалось завершить проект');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSuccessClose = () => {
    if (completedProject) onCompleted(completedProject);
  };

  const stepTitle = `Шаг ${stepIndex + 1} из ${activeSteps.length}`;

  if (showSuccess && completedProject) {
    const firstPattern = completedProject.patterns[0];
    const firstYarn = completedProject.yarns[0];
    const yarnPercent = firstYarn?.skein && firstYarn.skein.totalWeightG > 0
      ? Math.round((firstYarn.skein.currentWeightG / firstYarn.skein.totalWeightG) * 100)
      : 0;
    return (
      <div ref={sheetRef} className={`log-usage-overlay sheet-overlay ${isVisible ? 'sheet-open' : ''}`} onClick={handleSuccessClose}>
        <div className="log-usage-panel sheet-panel" onClick={(e) => e.stopPropagation()}>
          <div className="complete-success-body">
            <div className="complete-success-icon">
              <Check size={40} strokeWidth={1.5} color="#abc6ba" />
            </div>

            {(firstPattern || completedProject.manualDescription) && (
              <div className="complete-success-pattern-card">
                <div className="complete-success-pattern-card-image">
                  {(completedProject.finishedPhotos[0] ?? firstYarn?.skein?.images[0]) && (
                    <img src={completedProject.finishedPhotos[0] ?? firstYarn?.skein?.images[0]} alt="" />
                  )}
                </div>
                <div className="complete-success-pattern-card-body">
                  <p className="complete-success-pattern-card-title">{completedProject.title}</p>
                  {(firstPattern?.patternAuthorSnapshot ?? completedProject.manualAuthor) && (
                    <p className="complete-success-pattern-card-meta"><b>Автор:</b> {firstPattern?.patternAuthorSnapshot ?? completedProject.manualAuthor}</p>
                  )}
                  <p className="complete-success-pattern-card-meta">
                    <b>Описание:</b> {firstPattern ? firstPattern.patternTitleSnapshot : completedProject.manualDescription}
                  </p>
                  {firstYarn?.amountAtCompletionG != null && (
                    <p className="complete-success-pattern-card-meta"><b>Расход:</b> {firstYarn.amountAtCompletionG} г</p>
                  )}
                </div>
              </div>
            )}

            {firstYarn && (
              <div className="complete-success-yarn">
                <p className="complete-success-yarn-title">{firstYarn.yarnNameSnapshot}</p>
                {firstYarn.brandSnapshot && (
                  <p className="complete-success-yarn-row"><b>Бренд:</b> {firstYarn.brandSnapshot}</p>
                )}
                {firstYarn.skein && (
                  <>
                    <p className="complete-success-yarn-row">
                      <b>Остаток:</b> {firstYarn.skein.currentWeightG} г из {firstYarn.skein.totalWeightG} г
                    </p>
                    <div className="stash-progress-bar">
                      <div className="stash-progress-fill" style={{ width: `${yarnPercent}%` }} />
                    </div>
                  </>
                )}
              </div>
            )}

            <button type="button" className="btn complete-success-close-btn" onClick={handleSuccessClose}>
              Закрыть
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={sheetRef} className={`log-usage-overlay sheet-overlay ${isVisible ? 'sheet-open' : ''}`} onClick={onClose}>
      <div className="log-usage-panel sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="log-usage-header">
          <h2 className="complete-wizard-title">Поздравляем с завершением проекта!</h2>
          <p className="complete-wizard-subtitle">Заполните информацию о проекте</p>
          <p className="log-usage-step">{stepTitle}</p>
          <p className="complete-wizard-project-title">{project.title}</p>
        </div>

        <div className="log-usage-body">
          {step === 1 && (
            <>
              <p className="log-usage-section-title">Пряжа</p>
              {yarnDrafts.map((y) => (
                <div key={y.skeinId} className="log-usage-field">
                  <label className="log-usage-label">{y.yarnNameSnapshot} — остаток {y.currentWeightG} г</label>
                  <input
                    className="log-usage-input"
                    value={y.amountG}
                    placeholder="Расход, г"
                    inputMode="numeric"
                    onChange={(e) => updateYarnAmount(y.skeinId, e.target.value)}
                  />
                </div>
              ))}
              {!isStep1Valid && <p className="log-usage-error">Проверьте значения расхода — не должны превышать остаток мотка.</p>}

              {/* Поиск/привязка пряжи прямо на этом шаге (Figma
                  node-id=1567:22951) — не только для пустого проекта:
                  можно привязать ещё моток, даже если один уже есть. */}
              <div className="log-usage-field">
                <input
                  className="log-usage-input"
                  value={yarnQuery}
                  placeholder="Найдите пряжу в хранилище"
                  onChange={(e) => setYarnQuery(e.target.value)}
                  onFocus={() => setIsYarnFieldFocused(true)}
                  onBlur={() => setIsYarnFieldFocused(false)}
                />
              </div>
              {yarnResults.length > 0 && (
                <div className="log-usage-cards-vertical">
                  {yarnResults.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="log-usage-card-row"
                      disabled={isAttachingYarn}
                      // onMouseDown, не onClick — onBlur инпута (выше)
                      // срабатывает раньше onClick при клике по кнопке
                      // (blur — часть смены фокуса на mousedown), список
                      // успел бы скрыться до того, как клик дойдёт до
                      // кнопки.
                      onMouseDown={(e) => { e.preventDefault(); handlePickYarn(s); }}
                    >
                      {s.images[0] && <img src={s.images[0]} alt="" className="log-usage-card-row-image" />}
                      <div className="log-usage-card-row-body">
                        <p className="log-usage-card-row-title">{s.yarnNameSnapshot}</p>
                        <p className="log-usage-card-row-meta"><b>Остаток:</b> {s.currentWeightG} г</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {!isSearchingYarn && yarnResults.length === 0 && (isYarnFieldFocused || yarnQuery.trim()) && (
                <>
                  <p className="log-usage-empty-text">
                    {yarnQuery.trim() ? 'В ваших запасах ничего не найдено' : 'В хранилище пока пусто'}
                  </p>
                  <button type="button" className="plus-add-button" onClick={() => setIsAddYarnOpen(true)}>
                    <Plus size={32} strokeWidth={1} className="plus-add-button-icon" />
                    Добавить новую пряжу
                  </button>
                </>
              )}

              {instrumentOptions.length > 0 && (
                <div className="log-usage-field">
                  <label className="log-usage-label">Инструмент</label>
                  <div className="add-project-checkbox-list">
                    {instrumentOptions.map((opt) => {
                      const checked = opt.id in instrumentSizes;
                      return (
                        <div key={opt.id} className="add-project-instrument-row">
                          <button type="button" className="add-project-checkbox-row" onClick={() => toggleInstrument(opt.id)}>
                            {checked ? <SquareCheck size={24} strokeWidth={1.5} /> : <Square size={24} strokeWidth={1.5} color="#9b9a9a" />}
                            <span>{opt.name}</span>
                          </button>
                          {checked && (
                            <label className="add-project-instrument-size">
                              №
                              <span className="add-project-instrument-size-input-wrap">
                                <input
                                  className="add-project-input"
                                  value={instrumentSizes[opt.id]}
                                  placeholder="2,25"
                                  inputMode="decimal"
                                  onChange={(e) => updateInstrumentSize(opt.id, e.target.value)}
                                />
                                <span className="add-project-instrument-size-unit">мм</span>
                              </span>
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              {hasPattern ? (
                <p className="log-usage-empty-text">Описание уже привязано к проекту — менять на этом шаге не нужно.</p>
              ) : selectedPattern ? (
                <div className="log-usage-field">
                  <div className="log-usage-card-row log-usage-card-row--selected">
                    <div className="log-usage-card-row-body">
                      <p className="log-usage-card-row-title">{selectedPattern.title}</p>
                      <p className="log-usage-card-row-meta"><b>Автор:</b> {selectedPattern.author}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="log-usage-field">
                    <label className="log-usage-label">Описание</label>
                    <input
                      className="log-usage-input"
                      value={patternQuery}
                      placeholder="Введите название или автора"
                      onChange={(e) => setPatternQuery(e.target.value)}
                    />
                  </div>
                  <div className="log-usage-related">
                    {!isSearchingPattern && patternQuery.trim().length >= 2 && patternResults.length === 0 && (
                      <p className="log-usage-empty-text">Ничего не найдено</p>
                    )}
                    {patternResults.length > 0 && (
                      <>
                        <p className="log-usage-section-title">Результаты поиска</p>
                        <div className="log-usage-cards-vertical">
                          {patternResults.map((p) => (
                            <button key={p.id} type="button" className="log-usage-card-row" onClick={() => handlePickPattern(p)}>
                              <img src={p.thumbnailUrl} alt="" className="log-usage-card-row-image" />
                              <div className="log-usage-card-row-body">
                                <p className="log-usage-card-row-title">{p.title}</p>
                                <p className="log-usage-card-row-meta"><b>Автор:</b> {p.author}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {/* Показывается только вместе с результатами поиска (в
                        конце списка) или когда поиск дал 0 результатов — не
                        сразу при пустом поле (тот же принцип, что в
                        AddProjectModal.tsx). Не гейтится isSearchingPattern —
                        условие зависит только от длины query, не от
                        свежести результатов, а это убирало бы и
                        возвращало кнопку на каждый debounce, дёргая форму. */}
                    {patternQuery.trim().length >= 2 && (
                      <button type="button" className="plus-add-button" onClick={() => setIsManualEntryOpen((v) => !v)}>
                        <Plus size={32} strokeWidth={1} className="plus-add-button-icon" />
                        Добавить вручную
                      </button>
                    )}
                    {isManualEntryOpen && (
                      <div className="log-usage-manual-entry">
                        <div className="log-usage-field">
                          <label className="log-usage-label">Автор</label>
                          <input className="log-usage-input" value={manualAuthor} placeholder="Введите имя автора" onChange={(e) => setManualAuthor(e.target.value)} />
                        </div>
                        <div className="log-usage-field">
                          <label className="log-usage-label">Описание</label>
                          <input className="log-usage-input" value={manualDescription} placeholder="Введите название" onChange={(e) => setManualDescription(e.target.value)} />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {step === 3 && (
            <div className="log-usage-field">
              <label className="log-usage-label">Фото готового изделия</label>
              <div className="log-usage-photos">
                {finishedPhotos.map((url) => (
                  <div key={url} className="log-usage-photo-thumb">
                    <img src={url} alt="" />
                    <button type="button" className="log-usage-photo-remove" onClick={() => removePhoto(url)}>×</button>
                  </div>
                ))}
                {finishedPhotos.length < MAX_PHOTOS && (
                  <button type="button" className="log-usage-photo-add" onClick={() => photoInputRef.current?.click()} disabled={isUploadingPhoto}>+</button>
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
          {!isLastStep ? (
            <button type="button" className="btn log-usage-next-btn" onClick={goNext} disabled={step === 1 && !isStep1Valid}>
              Далее
            </button>
          ) : (
            <button type="button" className="btn log-usage-next-btn" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? 'Сохранение...' : 'Завершить проект'}
            </button>
          )}
          <button type="button" className="btn log-usage-close-btn" onClick={stepIndex === 0 ? onClose : goBack} disabled={isSubmitting}>
            {stepIndex === 0 ? 'Закрыть' : 'Назад'}
          </button>
        </div>
      </div>

      <AddYarnModal
        isOpen={isAddYarnOpen}
        initialNameQuery={yarnQuery}
        onClose={() => setIsAddYarnOpen(false)}
        onCreated={handleYarnCreated}
        onLimitReached={() => {
          setIsAddYarnOpen(false);
          setIsYarnLimitPaywallOpen(true);
        }}
      />

      <StashPaywallBanner
        isOpen={isYarnLimitPaywallOpen}
        reason="limit"
        freeLimit={10}
        onClose={() => setIsYarnLimitPaywallOpen(false)}
      />
    </div>
  );
};
