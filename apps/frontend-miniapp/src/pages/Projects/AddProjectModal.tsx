import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Plus, ChevronDown, SquareCheck, Square, Trash2 } from 'lucide-react';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import { STATUS_LABEL, STATUS_COLOR, STATUS_ICON, STATUS_ORDER } from './projectStatus';
import {
  createProject,
  updateProject,
  completeProject,
  deleteProject,
  addProjectYarn,
  createProjectSwatch,
  uploadProjectDocument,
  deleteProjectDocument,
  ProjectDetail,
  ProjectDocument,
  ProjectInstrumentInput,
  ProjectStatus,
  ProjectLimitReachedError,
  YarnUsageInput,
} from '../../api/projectsApi';
import { fetchPatterns, fetchPatternById, fetchFilters, Pattern, FilterOption } from '../../api/patternsApi';
import { fetchStashSkeins, uploadStashImage, StashSkein } from '../../api/stashApi';

import { DateInputField } from './DateInputField';
import { AddYarnModal } from '../Stash/AddYarnModal';
import { StashPaywallBanner } from '../../components/StashPaywallBanner/StashPaywallBanner';

// pdfjs-dist — тяжёлая зависимость (~1.3МБ worker), грузится только при
// реальном открытии PDF-вьюера, не с основным бандлом приложения.
const PdfViewerModal = lazy(() => import('./PdfViewerModal').then((m) => ({ default: m.PdfViewerModal })));
import '../../styles/sheet.css';
import './AddProjectModal.css';

const MAX_IMAGES = 5;

interface SelectedYarn {
  skeinId: string;
  yarnNameSnapshot: string;
  brandSnapshot: string | null;
  compositionSnapshot: string | null;
  mPer100gSnapshot: number | null;
  currentWeightG: number;
  totalWeightG: number;
  image: string | null;
  // Заполняется только для статуса COMPLETED (расход "задним числом") —
  // для IN_PROGRESS/PAUSED моток просто привязывается без списания веса
  // (см. PROJECTS_PLAN.md §2.2 — createProject различает skeinIds/yarnUsages
  // по статусу).
  amountG: string;
}

interface SwatchDraft {
  key: string;
  needleSizeRaw: string;
  strandsCount: string;
  stitchesBefore: string;
  rowsBefore: string;
  stitchesAfter: string;
  rowsAfter: string;
  images: string[];
}

function createEmptySwatchDraft(): SwatchDraft {
  return {
    key: `${Date.now()}-${Math.random()}`,
    needleSizeRaw: '',
    strandsCount: '',
    stitchesBefore: '',
    rowsBefore: '',
    stitchesAfter: '',
    rowsAfter: '',
    images: [],
  };
}

interface AddProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Режим создания: вызывается после успешного POST /projects.
  onCreated?: (project: ProjectDetail) => void;
  onLimitReached?: () => void;
  // Наличие project переключает форму в режим редактирования: заголовок
  // "Редактировать проект", поля предзаполнены, PATCH вместо POST,
  // разделы "Пряжа"/"Образец" скрыты (эти данные не принимает
  // updateProject — привязка пряжи и добавление образца остаются
  // отдельными действиями на карточке проекта), "Статус" остаётся
  // редактируемым (тот же переход, что на карточке — выбор COMPLETED
  // здесь тоже должен вести к визарду завершения, не сохраняться
  // напрямую), но сама форма создания сразу завершённым (обязательный
  // расход/фото при выборе статуса) не имеет смысла для уже
  // существующего проекта — тут это просто открывает недоступный путь.
  project?: ProjectDetail;
  onUpdated?: (project: ProjectDetail) => void;
  onRequestComplete?: () => void;
}

export const AddProjectModal: React.FC<AddProjectModalProps> = ({ isOpen, onClose, onCreated, onLimitReached, project, onUpdated, onRequestComplete }) => {
  const { isMounted, isVisible, sheetRef } = useSheetTransition(isOpen);
  const isEditMode = !!project;

  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('IN_PROGRESS');
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const [startedAt, setStartedAt] = useState('');
  const [completedAt, setCompletedAt] = useState('');

  const [patternQuery, setPatternQuery] = useState('');
  const [patternResults, setPatternResults] = useState<Pattern[]>([]);
  const [isSearchingPattern, setIsSearchingPattern] = useState(false);
  const [selectedPattern, setSelectedPattern] = useState<{ id: string; title: string; author: string; thumbnailUrl: string | null; instruments: string[] } | null>(null);
  const [isManualEntryOpen, setIsManualEntryOpen] = useState(false);
  const [manualAuthor, setManualAuthor] = useState('');
  const [manualDescription, setManualDescription] = useState('');

  const [instrumentOptions, setInstrumentOptions] = useState<FilterOption[]>([]);
  // Ключ — instrumentId выбранного (чекбокс включён) инструмента, значение —
  // введённый размер как СЫРАЯ строка поля ввода (не число: пользователь
  // печатает "2," и ещё не закончил вводить дробную часть — нельзя
  // прогонять через Number на каждый keystroke). Пустая строка — размер не
  // указан, но инструмент выбран.
  const [instrumentSizes, setInstrumentSizes] = useState<Record<string, string>>({});
  const instrumentsTouchedRef = useRef(false);

  const [yarnQuery, setYarnQuery] = useState('');
  const [yarnResults, setYarnResults] = useState<StashSkein[]>([]);
  const [isSearchingYarn, setIsSearchingYarn] = useState(false);
  // Список запасов показывается уже по фокусу на поле, не дожидаясь ввода
  // первых символов — пустой search в fetchStashSkeins отдаёт первую
  // страницу всех мотков. isYarnFieldFocused отдельно от yarnResults.length,
  // чтобы список гарантированно скрывался при потере фокуса без ввода
  // (blur без клика по карточке — просто закрыли клавиатуру).
  const [isYarnFieldFocused, setIsYarnFieldFocused] = useState(false);
  const [selectedYarns, setSelectedYarns] = useState<SelectedYarn[]>([]);
  const [isAddYarnOpen, setIsAddYarnOpen] = useState(false);
  const [isYarnLimitPaywallOpen, setIsYarnLimitPaywallOpen] = useState(false);

  const [swatches, setSwatches] = useState<SwatchDraft[]>([]);
  const [uploadingSwatchKey, setUploadingSwatchKey] = useState<string | null>(null);
  const swatchFileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [referencePhotos, setReferencePhotos] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [finishedPhotos, setFinishedPhotos] = useState<string[]>([]);

  // PDF-описания — документ привязывается по существующему projectId. В
  // режиме создания его на момент открытия формы ещё нет, поэтому при
  // открытии формы в create-режиме мы тихо создаём проект-черновик
  // ("Новый проект", IN_PROGRESS, дата начала — сегодня) и работаем с его
  // id как с обычным projectId для загрузки PDF. Если пользователь закроет
  // форму, не сохранив её — черновик удаляется (см. handleClose). Если
  // сохранит — handleSave обновляет (PATCH) тот же черновик вместо
  // создания второго проекта.
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);
  const [viewingDocument, setViewingDocument] = useState<ProjectDocument | null>(null);
  const documentFileInputRef = useRef<HTMLInputElement>(null);
  const [draftProjectId, setDraftProjectId] = useState<string | null>(null);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const draftProjectIdRef = useRef<string | null>(null);
  const draftSavedRef = useRef(false);

  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);



  const referencePhotoInputRef = useRef<HTMLInputElement>(null);
  const finishedPhotoInputRef = useRef<HTMLInputElement>(null);
  const patternDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const yarnDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!isOpen) return;
    if (project) {
      setTitle(project.title);
      setStatus(project.status);
      const firstPattern = project.patterns[0];
      // Снапшот ProjectPattern хранит только title/author, не картинку —
      // предзаполняем сразу текстом (мгновенно), затем дозагружаем
      // thumbnail/инструменты живого паттерна отдельным запросом, если он
      // ещё существует в каталоге (patternId не null — может отсутствовать,
      // если паттерн удалён, см. onDelete: SetNull в схеме).
      setSelectedPattern(firstPattern ? {
        id: firstPattern.patternId ?? '',
        title: firstPattern.patternTitleSnapshot,
        author: firstPattern.patternAuthorSnapshot,
        thumbnailUrl: null,
        instruments: [],
      } : null);
      if (firstPattern?.patternId) {
        fetchPatternById(firstPattern.patternId)
          .then((p) => setSelectedPattern((prev) => (prev && prev.id === p.id ? { ...prev, thumbnailUrl: p.thumbnailUrl, instruments: p.instruments } : prev)))
          .catch(() => { });
      }
      setIsManualEntryOpen(!firstPattern && !!(project.manualAuthor || project.manualDescription));
      setManualAuthor(project.manualAuthor ?? '');
      setManualDescription(project.manualDescription ?? '');
      setInstrumentSizes(
        Object.fromEntries(project.instruments.map((i) => [i.instrumentId, i.sizeMm != null ? String(i.sizeMm) : '']))
      );
      instrumentsTouchedRef.current = true;
      setStartedAt(project.startedAt.slice(0, 10));
      setCompletedAt(project.completedAt ? project.completedAt.slice(0, 10) : '');
      setReferencePhotos(project.referencePhotos);
      setFinishedPhotos(project.finishedPhotos);
      setNote(project.note ?? '');
      setDocuments(project.documents);
    } else {
      setTitle('');
      setStatus('IN_PROGRESS');
      // Дата начала по умолчанию — сегодня (пользователь чаще всего
      // начинает проект сразу, а не в прошлом), но остаётся редактируемой.
      setStartedAt(new Date().toISOString().slice(0, 10));
      setCompletedAt('');
      setSelectedPattern(null);
      setIsManualEntryOpen(false);
      setManualAuthor('');
      setManualDescription('');
      setInstrumentSizes({});
      instrumentsTouchedRef.current = false;
      setReferencePhotos([]);
      setFinishedPhotos([]);
      setNote('');
      setDocuments([]);
      // Тихий черновик пересоздаётся с нуля на каждое новое открытие формы
      // создания (см. отдельный эффект ниже) — сбрасываем следы предыдущего.
      draftSavedRef.current = false;
      draftProjectIdRef.current = null;
      setDraftProjectId(null);
    }
    setViewingDocument(null);
    setIsStatusMenuOpen(false);
    setPatternQuery('');
    setPatternResults([]);
    setYarnQuery('');
    setYarnResults([]);
    setSelectedYarns([]);
    setIsAddYarnOpen(false);
    setIsYarnLimitPaywallOpen(false);
    setSwatches([]);
    setError(null);

    fetchFilters().then((res) => setInstrumentOptions(res.instruments)).catch(() => setInstrumentOptions([]));
  }, [isOpen, project]);

  // Тихое создание проекта-черновика для формы СОЗДАНИЯ — только так можно
  // прикрепить PDF-описание до нажатия "Сохранить" (загрузка документа
  // требует существующего projectId). Черновик создаётся один раз при
  // открытии формы и либо обновляется в handleSave (сценарий "сохранили"),
  // либо удаляется при закрытии без сохранения (см. cleanup ниже).
  useEffect(() => {
    if (!isOpen || isEditMode) return;
    let cancelled = false;
    setIsCreatingDraft(true);
    createProject({ title: 'Новый проект', status: 'IN_PROGRESS', startedAt: new Date().toISOString().slice(0, 10) })
      .then((created) => {
        if (cancelled) {
          // Форма уже закрылась, пока запрос летел — черновик никому не
          // нужен, подчищаем сразу же.
          deleteProject(created.id, false).catch(() => { });
          return;
        }
        draftProjectIdRef.current = created.id;
        setDraftProjectId(created.id);
      })
      .catch((err) => {
        if (err instanceof ProjectLimitReachedError) {
          onLimitReached?.();
          return;
        }
        if (!cancelled) setError('Не удалось подготовить проект для загрузки PDF');
      })
      .finally(() => { if (!cancelled) setIsCreatingDraft(false); });
    return () => {
      cancelled = true;
      // Пользователь закрыл форму, не нажав "Сохранить" — черновик остаётся
      // висеть в БД никак не завершённым проектом, поэтому удаляем его
      // (пряжа к нему ещё не привязана в create-режиме на этом этапе формы,
      // returnYarnToStash не имеет значения).
      if (draftProjectIdRef.current && !draftSavedRef.current) {
        deleteProject(draftProjectIdRef.current, false).catch(() => { });
      }
      draftProjectIdRef.current = null;
      setDraftProjectId(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isEditMode]);



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
      } catch {
        setPatternResults([]);
      } finally {
        setIsSearchingPattern(false);
      }
    }, 300);
    return () => { if (patternDebounceRef.current) clearTimeout(patternDebounceRef.current); };
  }, [patternQuery]);

  // Запускается и по вводу текста, и по самому факту фокуса на поле
  // (isYarnFieldFocused) — пустой yarnQuery + фокус означает "показать все
  // запасы", не дожидаясь первых символов. Дебаунс всё равно нужен: даже
  // при пустом query фокус может смениться туда-обратно (открыли/закрыли
  // клавиатуру), незачем слать запрос на каждое такое дрожание.
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
      } catch {
        setYarnResults([]);
      } finally {
        setIsSearchingYarn(false);
      }
    }, 300);
    return () => { if (yarnDebounceRef.current) clearTimeout(yarnDebounceRef.current); };
  }, [yarnQuery, isYarnFieldFocused]);

  if (!isMounted) return null;

  const handlePickPattern = (p: Pattern) => {
    setSelectedPattern({ id: p.id, title: p.title, author: p.author, thumbnailUrl: p.thumbnailUrl, instruments: p.instruments });
    setIsManualEntryOpen(false);
    setPatternQuery('');
    setPatternResults([]);
    if (!instrumentsTouchedRef.current && p.instruments.length > 0) {
      const ids = instrumentOptions.filter((o) => p.instruments.includes(o.name)).map((o) => o.id);
      if (ids.length > 0) {
        // Предзаполнение из паттерна — без размера (паттерн не знает
        // конкретный размер инструмента пользователя, только его тип).
        setInstrumentSizes(Object.fromEntries(ids.map((id) => [id, ''])));
      }
    }
  };

  const clearPattern = () => setSelectedPattern(null);

  const toggleInstrument = (id: string) => {
    instrumentsTouchedRef.current = true;
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

  const handlePickYarn = (skein: StashSkein) => {
    if (selectedYarns.some((y) => y.skeinId === skein.id)) return;
    setSelectedYarns((prev) => [...prev, {
      skeinId: skein.id,
      yarnNameSnapshot: skein.yarnNameSnapshot,
      brandSnapshot: skein.brandSnapshot,
      compositionSnapshot: skein.compositionSnapshot,
      mPer100gSnapshot: skein.mPer100gSnapshot,
      currentWeightG: skein.currentWeightG,
      totalWeightG: skein.totalWeightG,
      image: skein.images[0] ?? null,
      amountG: '',
    }]);
    setYarnQuery('');
    setYarnResults([]);
  };

  // Пряжи не нашлось в хранилище по поиску — тут же создаём новую (та же
  // форма, что в разделе "Пряжа"), и сразу привязываем её к проекту, а не
  // просто закрываем модалку с созданным мотком без дальнейшего действия.
  const handleYarnCreated = (skein: StashSkein) => {
    setIsAddYarnOpen(false);
    handlePickYarn(skein);
  };

  const removeYarn = (skeinId: string) => setSelectedYarns((prev) => prev.filter((y) => y.skeinId !== skeinId));

  const updateYarnAmount = (skeinId: string, amountG: string) => {
    setSelectedYarns((prev) => prev.map((y) => (y.skeinId === skeinId ? { ...y, amountG } : y)));
  };

  const updateSwatch = (key: string, patch: Partial<SwatchDraft>) => {
    setSwatches((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  };

  const handleAddSwatch = () => setSwatches((prev) => [...prev, createEmptySwatchDraft()]);

  const removeSwatch = (key: string) => {
    setSwatches((prev) => prev.filter((s) => s.key !== key));
    delete swatchFileInputRefs.current[key];
  };

  const handleSwatchFileSelected = (key: string) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const swatch = swatches.find((s) => s.key === key);
    if (!file || !swatch || swatch.images.length >= MAX_IMAGES) return;
    setUploadingSwatchKey(key);
    try {
      const url = await uploadStashImage(file);
      updateSwatch(key, { images: [...swatch.images, url] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить фото образца');
    } finally {
      setUploadingSwatchKey(null);
    }
  };

  const removeSwatchImage = (key: string, url: string) => {
    const swatch = swatches.find((s) => s.key === key);
    if (!swatch) return;
    updateSwatch(key, { images: swatch.images.filter((u) => u !== url) });
  };

  const handleReferencePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    const remainingSlots = MAX_IMAGES - referencePhotos.length;
    if (remainingSlots <= 0) return;
    setIsUploading(true);
    try {
      for (const file of files.slice(0, remainingSlots)) {
        const url = await uploadStashImage(file);
        setReferencePhotos((prev) => [...prev, url]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить фото');
    } finally {
      setIsUploading(false);
    }
  };

  const removeReferencePhoto = (url: string) => setReferencePhotos((prev) => prev.filter((u) => u !== url));

  const MAX_DOCUMENTS = 5;

  // В режиме редактирования грузим в реальный project.id, в режиме
  // создания — в id тихого черновика (см. эффект выше).
  const documentProjectId = project?.id ?? draftProjectId;

  const handleDocumentFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !documentProjectId || documents.length >= MAX_DOCUMENTS) return;
    setIsUploadingDocument(true);
    try {
      const created = await uploadProjectDocument(documentProjectId, file);
      setDocuments((prev) => [...prev, created]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить файл');
    } finally {
      setIsUploadingDocument(false);
    }
  };

  const handleDeleteDocument = async (id: string) => {
    try {
      await deleteProjectDocument(id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить файл');
    }
  };

  const handleFinishedPhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    const remainingSlots = MAX_IMAGES - finishedPhotos.length;
    if (remainingSlots <= 0) return;
    setIsUploading(true);
    try {
      for (const file of files.slice(0, remainingSlots)) {
        const url = await uploadStashImage(file);
        setFinishedPhotos((prev) => [...prev, url]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить фото');
    } finally {
      setIsUploading(false);
    }
  };

  const removeFinishedPhoto = (url: string) => setFinishedPhotos((prev) => prev.filter((u) => u !== url));

  // instrumentSizes → payload: пустая строка размера — инструмент выбран,
  // но размер не указан (sizeMm: null), нечисловой ввод игнорируется как
  // ещё не завершённый (запятая вместо точки — обычный десятичный
  // разделитель в русской локали).
  const instrumentsPayload: ProjectInstrumentInput[] = Object.entries(instrumentSizes).map(([instrumentId, size]) => {
    const normalized = size.trim().replace(',', '.');
    const sizeMm = normalized === '' ? null : Number(normalized);
    return { instrumentId, sizeMm: sizeMm != null && Number.isFinite(sizeMm) ? sizeMm : null };
  });

  const isCompleted = status === 'COMPLETED';

  // COMPLETED требует явно указанного расхода по каждому привязанному
  // мотку (backdated-механика) — пустое поле = "не списывать" на бэкенде,
  // но раз пользователь уже привязал моток к завершённому проекту, форма
  // просит заполнить хотя бы что-то, иначе привязка выглядит бессмысленной.
  const isValid =
    title.trim().length > 0 &&
    selectedYarns.every((y) => !isCompleted || (Number(y.amountG) > 0 && Number(y.amountG) <= y.currentWeightG));

  const handleSave = async () => {
    if (!isValid || isSubmitting) return;
    // В режиме редактирования визард завершения нужен только когда статус
    // ПЕРЕКЛЮЧАЮТ на COMPLETED прямо сейчас (тот же путь, что и dropdown
    // статуса на карточке проекта) — он запрашивает расход пряжи и фото,
    // которых без него взять неоткуда. Если проект уже БЫЛ завершён и
    // статус в форме остаётся COMPLETED (правится что-то другое —
    // название, заметка, инструмент), это обычное сохранение: бэкенд сам
    // разрешает PATCH со status: COMPLETED, когда он не меняется (см.
    // updateProject), визард здесь просто не нужен.
    if (isEditMode && isCompleted && project?.status !== 'COMPLETED') {
      onRequestComplete?.();
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      if (isEditMode && project) {
        const updated = await updateProject(project.id, {
          title: title.trim(),
          status: status as Exclude<ProjectStatus, 'COMPLETED'>,
          startedAt: startedAt || undefined,
          patternIds: selectedPattern ? [selectedPattern.id] : [],
          manualAuthor: !selectedPattern ? manualAuthor.trim() || null : null,
          manualDescription: !selectedPattern ? manualDescription.trim() || null : null,
          instruments: instrumentsPayload,
          note: note.trim() || null,
          referencePhotos,
          finishedPhotos,
        });
        onUpdated?.(updated);
        return;
      }

      const yarnUsages: YarnUsageInput[] = selectedYarns.map((y) => ({
        skeinId: y.skeinId,
        amountG: isCompleted ? Number(y.amountG) : undefined,
      }));
      const swatchPayloads = swatches
        .filter((s) => s.needleSizeRaw.trim() || s.strandsCount || s.stitchesBefore || s.rowsBefore || s.stitchesAfter || s.rowsAfter || s.images.length > 0)
        .map((s) => ({
          images: s.images,
          needleSizeRaw: s.needleSizeRaw.trim() || undefined,
          strandsCount: s.strandsCount ? Number(s.strandsCount) : undefined,
          densityStitchesBefore: s.stitchesBefore ? Number(s.stitchesBefore) : undefined,
          densityRowsBefore: s.rowsBefore ? Number(s.rowsBefore) : undefined,
          densityStitchesAfter: s.stitchesAfter ? Number(s.stitchesAfter) : undefined,
          densityRowsAfter: s.rowsAfter ? Number(s.rowsAfter) : undefined,
        }));

      if (draftProjectId) {
        // Черновик уже создан тихо (при открытии формы — ради возможности
        // прикрепить PDF ещё до сохранения). "Создание" здесь — на самом
        // деле дозаполнение того же проекта: PATCH метаданных, затем
        // привязка пряжи/образцов отдельными запросами (PATCH их не
        // принимает), затем — при статусе COMPLETED — перевод в завершённое
        // состояние через тот же эндпоинт, что использует визард
        // завершения (backdated-механика идентична прежней ветке createProject).
        draftSavedRef.current = true;
        const patchedDraft = await updateProject(draftProjectId, {
          title: title.trim(),
          status: 'IN_PROGRESS',
          startedAt: startedAt || undefined,
          patternIds: selectedPattern ? [selectedPattern.id] : [],
          manualAuthor: !selectedPattern ? manualAuthor.trim() || null : null,
          manualDescription: !selectedPattern ? manualDescription.trim() || null : null,
          instruments: instrumentsPayload,
          note: note.trim() || null,
          referencePhotos,
          finishedPhotos,
        });
        for (const y of selectedYarns) {
          await addProjectYarn(draftProjectId, y.skeinId);
        }
        for (const s of swatchPayloads) {
          await createProjectSwatch(draftProjectId, s);
        }
        const finalProject = isCompleted
          ? await completeProject(draftProjectId, {
            yarnUsages,
            finishedPhotos,
          })
          : patchedDraft;
        onCreated?.(finalProject);
        return;
      }

      // Запасной путь — если тихий черновик по какой-то причине не создался
      // (например, форма открылась до ответа сети, а пользователь успел
      // сохранить), ведём себя как раньше: создаём проект одним запросом.
      const createdProject = await createProject({
        title: title.trim(),
        status,
        startedAt: startedAt || undefined,
        completedAt: isCompleted ? (completedAt || undefined) : undefined,
        patternIds: selectedPattern ? [selectedPattern.id] : undefined,
        manualAuthor: !selectedPattern ? manualAuthor.trim() || undefined : undefined,
        manualDescription: !selectedPattern ? manualDescription.trim() || undefined : undefined,
        instruments: instrumentsPayload.length > 0 ? instrumentsPayload : undefined,
        note: note.trim() || undefined,
        referencePhotos,
        // Фото изделия сохраняются при любом статусе, не только COMPLETED
        // — проект "В процессе"/"На паузе" тоже может иметь промежуточные
        // фото результата, форма не прячет этот блок за статусом.
        finishedPhotos,
        swatches: swatchPayloads.length > 0 ? swatchPayloads : undefined,
        ...(isCompleted
          ? { yarnUsages }
          : { skeinIds: selectedYarns.map((y) => y.skeinId) }),
      });
      onCreated?.(createdProject);
    } catch (err) {
      if (err instanceof ProjectLimitReachedError) {
        onLimitReached?.();
        return;
      }
      setError(err instanceof Error ? err.message : isEditMode ? 'Не удалось сохранить проект' : 'Не удалось создать проект');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div ref={sheetRef} className={`add-project-overlay sheet-overlay ${isVisible ? 'sheet-open' : ''}`} onClick={onClose}>
      <div className="add-project-panel sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="add-project-header">
          <h2 className="add-project-title">{isEditMode ? 'Редактировать проект' : 'Новый проект'}</h2>
        </div>

        <div className="add-project-body">
          <div className="add-project-section">
            <p className="add-project-section-title">О проекте</p>

            <div className="add-project-field">
              <label className="add-project-label">Название</label>
              <input className="add-project-input" value={title} placeholder="Введите текст..." onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div className="add-project-field">
              <label className="add-project-label">Описание (выбрать из каталога)</label>
              <input
                className="add-project-input"
                value={selectedPattern ? selectedPattern.title : patternQuery}
                placeholder="Введите название или автора"
                readOnly={!!selectedPattern}
                onChange={(e) => setPatternQuery(e.target.value)}
              />
            </div>

            {selectedPattern ? (
              <div className="add-project-section-inner">
                <p className="add-project-inner-label">Выбрано из каталога</p>
                <div className="add-project-pattern-card add-project-pattern-card--static">
                  <div className="add-project-pattern-card-image">
                    {selectedPattern.thumbnailUrl && <img src={selectedPattern.thumbnailUrl} alt="" />}
                  </div>
                  <div className="add-project-pattern-card-body">
                    <p className="add-project-pattern-card-title">{selectedPattern.title}</p>
                    <p className="add-project-pattern-card-meta"><b>Автор:</b> {selectedPattern.author}</p>
                    {selectedPattern.instruments.length > 0 && (
                      <p className="add-project-pattern-card-meta"><b>Инструмент:</b> {selectedPattern.instruments.join(', ')}</p>
                    )}
                  </div>
                </div>
                <button type="button" className="add-project-text-link-btn" onClick={clearPattern}>
                  Сбросить выбор
                </button>
              </div>
            ) : (
              <div className="add-project-section-inner">
                {isSearchingPattern && <p className="loading-message">Загрузка...</p>}
                {!isSearchingPattern && patternQuery.trim().length >= 2 && patternResults.length === 0 && (
                  <p className="add-project-empty-text">Ничего не найдено</p>
                )}
                {!isSearchingPattern && patternResults.length > 0 && (
                  <>
                    <p className="add-project-inner-label">Выбрать из каталога</p>
                    <div className="add-project-cards-vertical">
                      {patternResults.map((p) => (
                        <button key={p.id} type="button" className="add-project-pattern-card" onClick={() => handlePickPattern(p)}>
                          <div className="add-project-pattern-card-image">
                            <img src={p.thumbnailUrl} alt="" />
                          </div>
                          <div className="add-project-pattern-card-body">
                            <p className="add-project-pattern-card-title">{p.title}</p>
                            <p className="add-project-pattern-card-meta"><b>Автор:</b> {p.author}</p>
                            {p.instruments.length > 0 && (
                              <p className="add-project-pattern-card-meta"><b>Инструмент:</b> {p.instruments.join(', ')}</p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {/* Показывается только вместе с результатами поиска (в
                    конце списка) или когда поиск дал 0 результатов — не
                    сразу при пустом поле и не во время самого поиска. */}
                {!isSearchingPattern && patternQuery.trim().length >= 2 && (
                  <button type="button" className="plus-add-button" onClick={() => setIsManualEntryOpen((v) => !v)}>
                    <Plus size={32} strokeWidth={1} className="plus-add-button-icon" />
                    Добавить вручную
                  </button>
                )}
                {isManualEntryOpen && (
                  <div className="add-project-manual-entry">
                    <div className="add-project-field">
                      <label className="add-project-label">Автор</label>
                      <input className="add-project-input" value={manualAuthor} placeholder="Введите имя автора" onChange={(e) => setManualAuthor(e.target.value)} />
                    </div>
                    <div className="add-project-field">
                      <label className="add-project-label">Описание</label>
                      <input className="add-project-input" value={manualDescription} placeholder="Введите название" onChange={(e) => setManualDescription(e.target.value)} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="add-project-status-row-wrap">
            <p className="add-project-section-title">Статус</p>
            <div className="add-project-status-dropdown-wrap">
              <button
                type="button"
                className="status-badge"
                style={{ background: STATUS_COLOR[status] }}
                onClick={() => setIsStatusMenuOpen((v) => !v)}
              >
                {(() => {
                  const Icon = STATUS_ICON[status]; return (
                    <span className="projects-status-icon-wrap">
                      <Icon size={13} strokeWidth={1.5} color="#ffffff" />
                    </span>
                  );
                })()}
                {STATUS_LABEL[status]}
              </button>
              <ChevronDown size={24} strokeWidth={1.5} onClick={() => setIsStatusMenuOpen((v) => !v)} style={{ cursor: 'pointer' }} />
              {isStatusMenuOpen && (
                <div className="status-dropdown-list">
                  {STATUS_ORDER
                    .filter((s) => s !== status)
                    .map((s) => {
                      const Icon = STATUS_ICON[s];
                      return (
                        <button
                          key={s}
                          type="button"
                          className="status-badge"
                          style={{ background: STATUS_COLOR[s] }}
                          onClick={() => { setStatus(s); setIsStatusMenuOpen(false); }}
                        >
                          <span className="projects-status-icon-wrap">
                            <Icon size={13} strokeWidth={1.5} color="#ffffff" />
                          </span>
                          {STATUS_LABEL[s]}
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
          {!isEditMode && isCompleted && (
            <p className="add-project-field-hint" style={{ padding: '0 20px' }}>
              Проект будет создан сразу завершённым — для портфолио задним числом. Остаток пряжи в хранилище не изменится, изменится только общий вес мотка.
            </p>
          )}
          {isEditMode && isCompleted && project?.status !== 'COMPLETED' && (
            <p className="add-project-field-hint" style={{ padding: '0 20px' }}>
              Для завершения проекта нужно указать расход пряжи и фото готового изделия — нажмите "Сохранить", чтобы перейти к этому шагу.
            </p>
          )}

          <div className="add-project-section">
            <p className="add-project-section-title">Сроки</p>
            <div className="add-project-dates-row">
              <DateInputField label="Начало" value={startedAt} onChange={setStartedAt} />
              <DateInputField label="Завершено" value={completedAt} onChange={setCompletedAt} disabled={!isCompleted} align="end" />
            </div>
          </div>

          {instrumentOptions.length > 0 && (
            <div className="add-project-section">
              <p className="add-project-section-title">Инструмент</p>
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
                              className="add-project-input add-project-input-instrument-size"
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

          {!isEditMode && (
            <div className="add-project-section">
              <p className="add-project-section-title">Пряжа</p>
              {selectedYarns.map((y) => (
                <div key={y.skeinId} className="add-project-yarn-card-wrap">
                  <div className="add-project-yarn-card">
                    <div className="add-project-yarn-card-image">
                      {y.image ? <img src={y.image} alt="" /> : null}
                    </div>
                    <div className="add-project-yarn-card-body">
                      <div className="add-project-yarn-card-title-row">
                        <p className="add-project-yarn-card-title">{y.yarnNameSnapshot}</p>
                        <button type="button" className="add-project-chip-remove" onClick={() => removeYarn(y.skeinId)}>×</button>
                      </div>
                      {y.brandSnapshot && <p className="add-project-yarn-card-meta"><b>Бренд:</b> {y.brandSnapshot}</p>}
                      {y.compositionSnapshot && <p className="add-project-yarn-card-meta"><b>Состав:</b> {y.compositionSnapshot}</p>}
                      {y.mPer100gSnapshot != null && <p className="add-project-yarn-card-meta"><b>Метраж:</b> {y.mPer100gSnapshot}м/100г</p>}
                      <p className="add-project-yarn-card-remainder"><b>Остаток:</b> {y.currentWeightG} г из {y.totalWeightG} г</p>
                    </div>
                  </div>
                  {isCompleted && (
                    <div className="add-project-field">
                      <label className="add-project-label">Расход</label>
                      <input
                        className="add-project-input"
                        value={y.amountG}
                        placeholder="320"
                        inputMode="numeric"

                        onChange={(e) => updateYarnAmount(y.skeinId, e.target.value)}
                      />
                    </div>
                  )}
                </div>
              ))}

              <div className="add-project-field">
                <input
                  className="add-project-input"
                  value={yarnQuery}
                  placeholder="Выбрать пряжу из моих запасов"
                  onChange={(e) => setYarnQuery(e.target.value)}
                  onFocus={() => setIsYarnFieldFocused(true)}
                  onBlur={() => setIsYarnFieldFocused(false)}
                />
              </div>
              {isSearchingYarn && <p className="loading-message">Загрузка...</p>}
              {!isSearchingYarn && yarnResults.length > 0 && (
                <div className="add-project-cards-vertical">
                  {yarnResults.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="add-project-yarn-search-card"
                      // onMouseDown, не onClick — onBlur инпута (выше)
                      // срабатывает раньше onClick этой кнопки при клике по
                      // ней (blur — часть mousedown/focus-смены), список
                      // успел бы скрыться до того, как клик дойдёт до
                      // кнопки. mousedown происходит раньше blur.
                      onMouseDown={(e) => { e.preventDefault(); handlePickYarn(s); }}
                    >
                      <div className="add-project-yarn-card-image">
                        {s.images[0] ? <img src={s.images[0]} alt="" /> : null}
                      </div>
                      <div className="add-project-yarn-card-body">
                        <p className="add-project-yarn-card-title">{s.yarnNameSnapshot}</p>
                        {s.brandSnapshot && <p className="add-project-yarn-card-meta"><b>Бренд:</b> {s.brandSnapshot}</p>}
                        {s.compositionSnapshot && <p className="add-project-yarn-card-meta"><b>Состав:</b> {s.compositionSnapshot}</p>}
                        {s.mPer100gSnapshot != null && <p className="add-project-yarn-card-meta"><b>Метраж:</b> {s.mPer100gSnapshot}м/100г</p>}
                        <p className="add-project-yarn-card-remainder"><b>Остаток:</b> {s.currentWeightG} г из {s.totalWeightG} г</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {!isSearchingYarn && yarnQuery.trim().length >= 2 && yarnResults.length === 0 && (
                <>
                  <p className="add-project-empty-text">В ваших запасах ничего не найдено</p>
                  <button type="button" className="plus-add-button" onClick={() => setIsAddYarnOpen(true)}>
                    <Plus size={32} strokeWidth={1} className="plus-add-button-icon" />
                    Добавить новую пряжу
                  </button>
                </>
              )}
            </div>
          )}

          {!isEditMode && (
            <div className="add-project-section">
              <p className="add-project-section-title">Образец</p>

              {swatches.map((swatch, index) => (
                <div key={swatch.key} className="add-project-swatch-draft">
                  {swatches.length > 1 && (
                    <div className="add-project-swatch-draft-header">
                      <span>Образец {index + 1}</span>
                      <button type="button" className="add-project-swatch-remove" onClick={() => removeSwatch(swatch.key)}>Удалить</button>
                    </div>
                  )}
                  <div className="add-project-field">
                    <label className="add-project-label">Размер инструмента</label>
                    <input className="add-project-input" value={swatch.needleSizeRaw} placeholder="Введите текст..." onChange={(e) => updateSwatch(swatch.key, { needleSizeRaw: e.target.value })} />
                  </div>
                  <div className="add-project-field">
                    <label className="add-project-label">Количество нитей</label>
                    <input className="add-project-input" value={swatch.strandsCount} placeholder="Введите число..." inputMode="numeric" onChange={(e) => updateSwatch(swatch.key, { strandsCount: e.target.value })} />
                  </div>
                  <div className="add-project-field">
                    <label className="add-project-label">До ВТО</label>
                    <div className="add-project-density-row">
                      <div className="add-project-density-col">
                        <input className="add-project-input" value={swatch.stitchesBefore} placeholder="46" inputMode="decimal" onChange={(e) => updateSwatch(swatch.key, { stitchesBefore: e.target.value })} />
                        <span className="add-project-density-sublabel">Петли</span>
                      </div>
                      <span className="add-project-density-x">х</span>
                      <div className="add-project-density-col">
                        <input className="add-project-input" value={swatch.rowsBefore} placeholder="52" inputMode="decimal" onChange={(e) => updateSwatch(swatch.key, { rowsBefore: e.target.value })} />
                        <span className="add-project-density-sublabel">Ряды</span>
                      </div>
                    </div>
                  </div>
                  <div className="add-project-field">
                    <label className="add-project-label">После ВТО</label>
                    <div className="add-project-density-row">
                      <div className="add-project-density-col">
                        <input className="add-project-input" value={swatch.stitchesAfter} placeholder="46" inputMode="decimal" onChange={(e) => updateSwatch(swatch.key, { stitchesAfter: e.target.value })} />
                        <span className="add-project-density-sublabel">Петли</span>
                      </div>
                      <span className="add-project-density-x">х</span>
                      <div className="add-project-density-col">
                        <input className="add-project-input" value={swatch.rowsAfter} placeholder="52" inputMode="decimal" onChange={(e) => updateSwatch(swatch.key, { rowsAfter: e.target.value })} />
                        <span className="add-project-density-sublabel">Ряды</span>
                      </div>
                    </div>
                  </div>
                  <div className="add-project-field">
                    <label className="add-project-label">Фото образца</label>
                    <div className="add-project-photos">
                      {swatch.images.map((url) => (
                        <div key={url} className="add-project-photo-thumb">
                          <img src={url} alt="" />
                          <button type="button" className="add-project-photo-remove" onClick={() => removeSwatchImage(swatch.key, url)}>×</button>
                        </div>
                      ))}
                      {swatch.images.length < MAX_IMAGES && (
                        <button type="button" className="add-project-photo-add" onClick={() => swatchFileInputRefs.current[swatch.key]?.click()} disabled={uploadingSwatchKey === swatch.key}>+</button>
                      )}
                      <input
                        ref={(el) => { swatchFileInputRefs.current[swatch.key] = el; }}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        style={{ display: 'none' }}
                        onChange={handleSwatchFileSelected(swatch.key)}
                      />
                    </div>
                  </div>
                </div>
              ))}

              <button type="button" className="plus-add-button" onClick={handleAddSwatch}>
                <Plus size={32} strokeWidth={1} className="plus-add-button-icon" />
                {swatches.length > 0 ? 'Добавить ещё образец' : 'Добавить образец'}
              </button>
            </div>
          )}

          <div className="add-project-section">
            <p className="add-project-section-title">Описание, файл</p>
            {!isEditMode && isCreatingDraft ? (
              <p className="add-project-field-hint">Подготовка загрузки...</p>
            ) : (
              <>
                {documents.map((doc) => (
                  <div key={doc.id} className="add-project-pdf-row">
                    <button type="button" className="add-project-pdf-link" onClick={() => setViewingDocument(doc)}>
                      #{doc.originalFileName}
                    </button>
                    <button type="button" className="add-project-pdf-remove" onClick={() => handleDeleteDocument(doc.id)} aria-label="Удалить файл">
                      <Trash2 size={16} strokeWidth={1.5} />
                    </button>
                  </div>
                ))}
                {documents.length < MAX_DOCUMENTS && (
                  <button type="button" className="add-project-pdf-upload-btn" onClick={() => documentFileInputRef.current?.click()} disabled={isUploadingDocument || !documentProjectId}>
                    <Plus size={8} strokeWidth={1.5} />
                    {isUploadingDocument ? 'Загрузка...' : 'Загрузить pdf'}
                  </button>
                )}
                <input
                  ref={documentFileInputRef}
                  type="file"
                  accept="application/pdf"
                  style={{ display: 'none' }}
                  onChange={handleDocumentFileSelected}
                />
              </>
            )}
          </div>

          <div className="add-project-section">
            <p className="add-project-section-title">Референс</p>
            <div className="add-project-photos">
              {referencePhotos.map((url) => (
                <div key={url} className="add-project-photo-thumb">
                  <img src={url} alt="" />
                  <button type="button" className="add-project-photo-remove" onClick={() => removeReferencePhoto(url)}>×</button>
                </div>
              ))}
              {referencePhotos.length < MAX_IMAGES && (
                <button type="button" className="add-project-photo-add" onClick={() => referencePhotoInputRef.current?.click()} disabled={isUploading}>+</button>
              )}
              <input ref={referencePhotoInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: 'none' }} onChange={handleReferencePhotoSelected} />
            </div>
          </div>

          <div className="add-project-section">
            <p className="add-project-section-title">Заметки</p>
            <textarea className="add-project-textarea" value={note} placeholder="Здесь можно писать всё, что душе угодно" onChange={(e) => setNote(e.target.value)} />
          </div>

          <div className="add-project-section">
            <p className="add-project-section-title">Фото изделия</p>
            <div className="add-project-photos">
              {finishedPhotos.map((url) => (
                <div key={url} className="add-project-photo-thumb">
                  <img src={url} alt="" />
                  <button type="button" className="add-project-photo-remove" onClick={() => removeFinishedPhoto(url)}>×</button>
                </div>
              ))}
              {finishedPhotos.length < MAX_IMAGES && (
                <button type="button" className="add-project-photo-add" onClick={() => finishedPhotoInputRef.current?.click()} disabled={isUploading}>+</button>
              )}
              <input ref={finishedPhotoInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: 'none' }} onChange={handleFinishedPhotoSelected} />
            </div>
          </div>

          {error && <p className="add-project-error">{error}</p>}
        </div>

        <div className="add-project-footer">
          <button type="button" className="btn add-project-close-btn" onClick={onClose} disabled={isSubmitting}>Закрыть</button>
          <button type="button" className="btn add-project-save-btn" onClick={handleSave} disabled={!isValid || isSubmitting}>
            {isSubmitting ? 'Сохранение...' : 'Сохранить'}
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

      {viewingDocument && (
        <Suspense fallback={null}>
          <PdfViewerModal
            isOpen={!!viewingDocument}
            documentId={viewingDocument.id}
            fileName={viewingDocument.originalFileName}
            onClose={() => setViewingDocument(null)}
          />
        </Suspense>
      )}
    </div>
  );
};
