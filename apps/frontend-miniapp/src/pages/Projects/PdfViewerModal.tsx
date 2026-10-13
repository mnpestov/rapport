// Первая строка (до pdfjs-dist!) — Promise.withResolvers() полифилл для
// основного потока, см. комментарий в самом файле.
import './promiseWithResolversPolyfill';
import React, { useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Trash2, MousePointer2, Highlighter, Pen, Eraser, Undo2 } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';

const { TextLayer } = pdfjsLib;
import {
  fetchProjectDocumentBlob,
  fetchDocumentHighlights,
  createDocumentHighlight,
  deleteDocumentHighlight,
  fetchDocumentDrawings,
  createDocumentDrawing,
  deleteDocumentDrawing,
  ProjectDocumentHighlight,
  ProjectDocumentDrawing,
  HighlightRect,
  DrawingPoint,
} from '../../api/projectsApi';
import './PdfViewerModal.css';

// Не workerSrc (строка URL — pdfjs сам делает `new Worker(url, {type:
// "module"})` без полифилла внутри), а собственный Worker через workerPort:
// pdfWorkerEntry.ts сначала ставит Promise.withResolvers() полифилл В
// КОНТЕКСТЕ ВОРКЕРА (self), затем импортирует настоящий pdf.worker.min.mjs.
// Нужен отдельно от promiseWithResolversPolyfill.ts ниже (тот патчит
// только основной поток страницы) — Worker выполняется в изолированном
// self, патчи основного потока туда не долетают. Воспроизведено на
// реальном устройстве (Safari/WebKit без нативной поддержки метода):
// canvas успевал отрисоваться, TextLayer тут же падал с "undefined is not
// a function" — оба места используют Promise.withResolvers() (ES2024),
// которого pdfjs-dist v6 нигде не полифиллит сам.
const pdfWorker = new Worker(new URL('./pdfWorkerEntry.ts', import.meta.url), { type: 'module' });
pdfjsLib.GlobalWorkerOptions.workerPort = pdfWorker;

// Figma node-id=3039:31704/32158 (PROJECTS_PLAN.md §8.2) — 3-4 цвета
// маркера, тот же принцип, что остальные цветовые акценты проекта
// (STATUS_COLOR и т.д.), не произвольная палитра.
const HIGHLIGHT_COLORS = ['#ffe066', '#a9ae36', '#bec1f4', '#d8520f'];

// Тонкая чёрная линия для заметок от руки — фиксированные цвет/толщина
// (не настраиваемый инструмент рисования, просто "перо"), см. запрос
// пользователя. Ластик стирает штрих целиком по попаданию курсора в его
// пиксельную область, не растирает частично.
const DRAWING_COLOR = '#1d1c1c';
const DRAWING_WIDTH = 1.5;
// В пикселях КАНВАСА (не экрана) при 100% логическом зуме — см.
// getDisplayScale()/eraseAtLocalPoint ниже, где это переводится в реальные
// экранные пиксели независимо от текущего масштаба.
const ERASER_HIT_RADIUS = 10;

// Зум поверх "базового" масштаба (100% = подогнано под ширину контейнера).
// 1..4 — тот же диапазон, что и раньше, в терминах ЛОГИЧЕСКОГО процента,
// который видит пользователь (100%..400%).
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

// Канвас печётся ОДИН раз за открытие страницы, сразу с запасом резкости
// на будущий зум — не на каждый шаг зума заново, как было раньше (именно
// эта схема — "дешёвый CSS-transform во время жеста, потом debounced
// re-render в новом разрешении, потом подгонка скролла под жест" — была
// источником всех предыдущих багов с зумом/паном). Теперь react-zoom-pan-
// pinch отвечает ТОЛЬКО за визуальный transform (zoom/pan/pinch) поверх уже
// готового канваса — печь новый растр при каждом шаге зума больше не нужно.
// 2 — разумный компромисс: на максимальном логическом зуме (400%)
// эффективная чёткость равна напечённому разрешению БЕЗ дополнительного
// размытия от CSS-растяжения сверху (см. MIN/MAX_LIB_SCALE ниже); больше —
// чётче на самом сильном зуме ценой заметно большего канваса в памяти.
const RENDER_ZOOM_HEADROOM = 2;
// "Шкала" react-zoom-pan-pinch — множитель ПОВЕРХ уже напечённого (с
// запасом headroom) канваса, не логический зум пользователя напрямую:
// 1/HEADROOM соответствует логическим 100% (напечённый канвас показан
// уменьшенным — "как было бы без запаса"), MAX_ZOOM/HEADROOM — логическим
// 400% (напечённый канвас показан БЕЗ дополнительного уменьшения/растяжения,
// пиксель в пиксель).
const MIN_LIB_SCALE = 1 / RENDER_ZOOM_HEADROOM;
const MAX_LIB_SCALE = MAX_ZOOM / RENDER_ZOOM_HEADROOM;

type ToolMode = 'pan' | 'highlight' | 'pen' | 'eraser';

interface PdfViewerModalProps {
  isOpen: boolean;
  documentId: string;
  fileName: string;
  onClose: () => void;
}

export const PdfViewerModal: React.FC<PdfViewerModalProps> = ({ isOpen, documentId, fileName, onClose }) => {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<ProjectDocumentHighlight[]>([]);
  const [selectedHighlightId, setSelectedHighlightId] = useState<string | null>(null);
  // Прямоугольник хайлайтера, который сейчас рисуется протягиванием
  // (локальные координаты канваса рисования, не PDF) — по pointerUp сразу
  // сохраняется уже выбранным цветом (см. selectedHighlightColor), без
  // промежуточной палитры у места выделения (та обрезалась краем
  // контейнера при выделении у границы страницы — прямая жалоба
  // пользователя, плюс сам порядок "сначала выдели, потом выбери цвет"
  // был нелогичным).
  const [inProgressHighlightRect, setInProgressHighlightRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  // Цвет, которым рисует хайлайтер прямо сейчас — выбирается ДО
  // выделения (палитра в тулбаре под кнопкой инструмента), не после.
  const [selectedHighlightColor, setSelectedHighlightColor] = useState(HIGHLIGHT_COLORS[0]);
  // Палитра цвета хайлайтера — открывается кликом по уже активной кнопке
  // "Хайлайтер" (сам инструмент включается первым кликом), закрывается
  // выбором цвета или повторным кликом по кнопке.
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);

  // Режим тулбара: "Стрелка" (дефолт — панорамирование увеличенной
  // страницы протягиванием), "Хайлайтер" (протягивание рисует
  // прямоугольник выделения в ЛЮБОМ месте страницы, не только по тексту,
  // сразу выбранным цветом), "Перо" (рисование тонкой чёрной линии) и
  // "Ластик" (тап/протягивание по штриху/выделению удаляет его целиком).
  const [toolMode, setToolMode] = useState<ToolMode>('pan');
  const [drawings, setDrawings] = useState<ProjectDocumentDrawing[]>([]);
  const [inProgressStroke, setInProgressStroke] = useState<DrawingPoint[] | null>(null);
  // viewportRef ниже — ref, не state (event-хендлеры читают его вне
  // React-рендера, не должны триггерить ре-рендер на каждый pointermove).
  // Но JSX ({viewport && highlights.map(...)}) читает viewportRef.current
  // напрямую при рендере — если viewport становится готов АСИНХРОННО
  // (после await renderTask.promise), а highlights/drawings уже
  // загрузились и вызвали setHighlights/setDrawings РАНЬШЕ, тот
  // ре-рендер видит ещё null viewport и рисует пусто; следующего
  // ре-рендера, который увидел бы уже готовый viewportRef.current, просто
  // не происходит — сам факт "viewport стал готов" не State, значит не
  // триггерит React. Отсюда баг: пометки появляются, только когда что-то
  // ДРУГОЕ (смена инструмента) случайно вызывает следующий ре-рендер.
  // viewportVersion — пустой счётчик специально для триггера ре-рендера
  // в момент готовности viewport, без дублирования самого объекта в state.
  const [viewportVersion, setViewportVersion] = useState(0);

  // Логический зум, который видит пользователь (1..4 = 100%..400%) — см.
  // MIN_ZOOM/MAX_ZOOM/RENDER_ZOOM_HEADROOM выше. Обновляется только по
  // завершении жеста/клика (handleGestureSettled/zoomStep), не на каждый
  // кадр — сам зум/пан визуально полностью ведёт react-zoom-pan-pinch,
  // это state нужен только для индикатора "%" и disabled у кнопок +/-.
  const [zoom, setZoom] = useState(MIN_ZOOM);
  // Императивный доступ к react-zoom-pan-pinch — сброс трансформации при
  // смене страницы (useEffect ниже) и шаг зума по кнопкам +/- (zoomStep,
  // кнопки лежат в футере, вне поддерева TransformWrapper, поэтому
  // useControls() тут не подходит — тот хук работает только из потомков).
  const transformRef = useRef<ReactZoomPanPinchContentRef>(null);

  const highlightToolBtnWrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageWrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const highlightLayerRef = useRef<HTMLDivElement>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  const pageRef = useRef<PDFPageProxy | null>(null);
  const viewportRef = useRef<any>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const isDrawingRef = useRef(false);
  const erasedInGestureRef = useRef<Set<string>>(new Set());
  // Активные пальцы на канвасе рисования — если их больше одного, значит
  // это pinch-жест (TransformWrapper сейчас отключён в режимах рисования,
  // см. disabled в JSX, но на миг между "второй палец лёг" и реакцией
  // библиотеки события на канвас всё равно успевают дойти), а не
  // протягивание выделения/пера: без этой проверки каждый палец pinch'а
  // независимо тянул свой прямоугольник/штрих — прямая причина жалобы
  // "вся страница в разных прямоугольниках".
  const activePointerIdsRef = useRef<Set<number>>(new Set());

  // Стек последних сохранённых выделений/штрихов для кнопки "Отменить" —
  // без него единственный способ убрать неверный штрих пера был переключить
  // инструмент на ластик и обратно (жалоба пользователя). Храним только то,
  // что создано В ЭТОМ сеансе просмотра — элементы, загруженные с сервера
  // при открытии страницы, сюда не попадают (undo не должен внезапно
  // стирать уже сохранённые раньше пометки).
  const undoStackRef = useRef<Array<{ kind: 'highlight' | 'drawing'; id: string }>>([]);
  const [canUndo, setCanUndo] = useState(false);

  // Загрузка бинарника документа — только при открытии/смене документа, не
  // при каждой смене страницы (страница рендерится из уже загруженного
  // PDFDocumentProxy).
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setPageNumber(1);
    setPdfDoc(null);

    fetchProjectDocumentBlob(documentId)
      .then((blob) => blob.arrayBuffer())
      .then((buffer) => pdfjsLib.getDocument({ data: buffer }).promise)
      .then((doc) => {
        if (cancelled) return;
        setPdfDoc(doc);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Не удалось открыть файл');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [isOpen, documentId]);

  // Отменяет "устаревшие" рендеры: каждый вызов renderPage запоминает свой
  // номер при старте, и после каждого await сверяет его с актуальным —
  // если за время ожидания стартовал более новый рендер (сменили страницу
  // ещё раз), текущий молча прекращается. Проще и надёжнее, чем
  // прокидывать cancel-флаг наружу через замыкание из async-функции (тот
  // вариант ломается: caller не может пометить cancelled=true ДО
  // завершения await'ов — флаг живёт только внутри самой функции).
  const renderTokenRef = useRef(0);

  // Полный рендер страницы в растр (canvas) — один раз на страницу, с
  // запасом резкости на будущий зум (см. RENDER_ZOOM_HEADROOM выше). Зум
  // после этого — чисто визуальный CSS-transform react-zoom-pan-pinch,
  // этот рендер больше НЕ вызывается заново на каждый шаг зума.
  const renderPage = async (): Promise<void> => {
    const page = pageRef.current;
    if (!page) return;
    const myToken = ++renderTokenRef.current;

    const containerWidth = containerRef.current?.clientWidth ?? 350;
    const baseViewport = page.getViewport({ scale: 1 });
    const fitScale = containerWidth / baseViewport.width;
    const scale = fitScale * RENDER_ZOOM_HEADROOM;
    const viewport = page.getViewport({ scale });
    viewportRef.current = viewport;

    const canvas = canvasRef.current;
    const textLayerEl = textLayerRef.current;
    if (!canvas || !textLayerEl) return;

    // devicePixelRatio — без этого canvas рендерится 1:1 в CSS-пикселях и
    // браузер растягивает его на физические пиксели экрана, отсюда
    // размытость на Retina/HiDPI (особенно заметно на телефоне, где DPR
    // почти всегда 2-3). Растровый буфер (canvas.width/height) больше
    // отображаемого CSS-размера в dpr раз, а видимый размер (style)
    // остаётся прежним — ctx.setTransform ниже компенсирует разницу при
    // рисовании.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    renderTaskRef.current?.cancel();
    const renderTask = page.render({ canvas, canvasContext: ctx, viewport } as any);
    renderTaskRef.current = renderTask;
    await renderTask.promise;
    if (renderTokenRef.current !== myToken) return;

    textLayerEl.innerHTML = '';
    textLayerEl.style.width = `${viewport.width}px`;
    textLayerEl.style.height = `${viewport.height}px`;
    textLayerEl.style.setProperty('--total-scale-factor', String(scale));

    const textContent = await page.getTextContent();
    if (renderTokenRef.current !== myToken) return;
    const textLayer = new TextLayer({
      textContentSource: textContent,
      container: textLayerEl,
      viewport,
    });
    await textLayer.render();
    if (renderTokenRef.current !== myToken) return;

    if (highlightLayerRef.current) {
      highlightLayerRef.current.style.width = `${viewport.width}px`;
      highlightLayerRef.current.style.height = `${viewport.height}px`;
    }
    if (drawingCanvasRef.current) {
      drawingCanvasRef.current.width = viewport.width;
      drawingCanvasRef.current.height = viewport.height;
      drawingCanvasRef.current.style.width = `${viewport.width}px`;
      drawingCanvasRef.current.style.height = `${viewport.height}px`;
    }
    // Триггерит ре-рендер, чтобы JSX (который читает viewportRef.current
    // напрямую) точно перечитал уже готовый viewport — см. комментарий у
    // объявления viewportVersion выше. Без этого пометки, загруженные ДО
    // завершения этого эффекта, остаются невидимыми до случайного
    // следующего ре-рендера по другой причине.
    setViewportVersion((v) => v + 1);
  };

  // Рендер текущей страницы: canvas + текстовый слой. Пересоздаётся при
  // смене страницы или после первой загрузки документа — зум/позиция
  // react-zoom-pan-pinch сбрасываются следом явно (новая страница не
  // обязана открываться с зумом предыдущей).
  useEffect(() => {
    if (!pdfDoc) return;
    setSelectedHighlightId(null);
    setInProgressHighlightRect(null);

    (async () => {
      const page = await pdfDoc.getPage(pageNumber);
      pageRef.current = page;
      await renderPage();
      transformRef.current?.setTransform(0, 0, MIN_LIB_SCALE, 0);
      setZoom(MIN_ZOOM);
    })().catch((err) => {
      // Полный stack trace в консоли — err.message на минифицированном
      // коде сам по себе малополезен (см. промахнувшуюся первую гипотезу
      // про Promise.withResolvers в комментарии у полифиллов; реальной
      // причиной оказался for-await-of на ReadableStream в getTextContent).
      console.error('[PdfViewerModal] render page failed:', err);
      setError(err instanceof Error ? err.message : 'Не удалось отрисовать страницу');
    });
  }, [pdfDoc, pageNumber]);

  // Существующие выделения для текущей страницы — перезагружаются при
  // смене страницы, не всей БД разом (PROJECTS_PLAN.md §8.2 п.4).
  useEffect(() => {
    if (!isOpen) return;
    fetchDocumentHighlights(documentId, pageNumber)
      .then(setHighlights)
      .catch(() => setHighlights([]));
  }, [isOpen, documentId, pageNumber]);

  // Существующие штрихи пера для текущей страницы — тот же принцип
  // подгрузки, что и highlights выше.
  useEffect(() => {
    if (!isOpen) return;
    fetchDocumentDrawings(documentId, pageNumber)
      .then(setDrawings)
      .catch(() => setDrawings([]));
  }, [isOpen, documentId, pageNumber]);

  // Стек "Отменить" — свой на каждую страницу/документ: иначе кнопка после
  // смены страницы могла бы незаметно для пользователя удалить пометку с
  // СОВСЕМ ДРУГОЙ страницы, которую он уже не видит.
  useEffect(() => {
    undoStackRef.current = [];
    setCanUndo(false);
  }, [documentId, pageNumber]);

  // Переключение инструмента сбрасывает незавершённые состояния других
  // инструментов — иначе застрявший inProgressHighlightRect от
  // "Хайлайтера" мог бы всплыть поверх холста в режиме "Пера".
  useEffect(() => {
    setSelectedHighlightId(null);
    setInProgressHighlightRect(null);
    activePointerIdsRef.current.clear();
    if (toolMode !== 'highlight') setIsColorPickerOpen(false);
  }, [toolMode]);

  // Закрытие палитры цвета кликом вне неё — тот же паттерн, что у
  // DateInputField.tsx (outside-click через mousedown, не click: не
  // конфликтует с onClick самой кнопки-триггера).
  useEffect(() => {
    if (!isColorPickerOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (highlightToolBtnWrapRef.current && !highlightToolBtnWrapRef.current.contains(e.target as Node)) {
        setIsColorPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isColorPickerOpen]);

  if (!isOpen) return null;

  // Переводит "библиотечный" масштаб в логический процент (1..4 = 100%..
  // 400%) для индикатора/кнопок +/- — на всякий случай ещё и клампим:
  // minScale/maxScale на TransformWrapper и так не дают реальному zoom
  // выйти за границы, но если когда-нибудь всё же долетит пограничное
  // значение (например, от библиотеки во время анимации), индикатор не
  // должен показать "меньше 100%" на странице, которая на самом деле уже
  // упёрлась в предел и не уменьшается.
  const clampDisplayZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  // Завершение зума пинчем/колесом-тачпада — переводим "библиотечный"
  // масштаб обратно в логический процент для индикатора/кнопок +/-. Во
  // время самого жеста zoom state НЕ трогаем — визуально всё ведёт сам
  // react-zoom-pan-pinch, лишний ре-рендер на каждый кадр не нужен (та же
  // идея, что раньше решал isPinchingRef, просто теперь не наша забота).
  const handleGestureSettled = (ctx: ReactZoomPanPinchContentRef) => {
    setZoom(clampDisplayZoom(ctx.state.scale * RENDER_ZOOM_HEADROOM));
  };

  // Кнопки +/- — используем родные zoomIn/zoomOut библиотеки (не
  // setTransform с текущими positionX/Y как раньше: тот держит левый
  // верхний угол контента на месте, из-за чего зум визуально "уезжал" в
  // один угол — zoomIn/zoomOut сами анимируют зум от ЦЕНТРА текущего
  // видимого окна, ровно как ожидается от кнопок +/-).
  const zoomStep = (direction: 1 | -1) => {
    const ctx = transformRef.current;
    if (!ctx) return;
    const step = 0.5 / RENDER_ZOOM_HEADROOM;
    const action = direction === 1 ? ctx.zoomIn(step, 200) : ctx.zoomOut(step, 200);
    action.then(() => {
      const settled = transformRef.current;
      if (settled) setZoom(clampDisplayZoom(settled.state.scale * RENDER_ZOOM_HEADROOM));
    });
  };

  const handleDeleteHighlight = async (id: string) => {
    setSelectedHighlightId(null);
    try {
      await deleteDocumentHighlight(id);
      setHighlights((prev) => prev.filter((h) => h.id !== id));
    } catch (err) {
      console.error('[PdfViewerModal] delete highlight failed:', err);
      setError(err instanceof Error ? err.message : 'Не удалось удалить выделение');
    }
  };

  // Во сколько раз канвас рисования СЕЙЧАС визуально крупнее/мельче своего
  // напечённого размера — канвас всегда рендерится в фиксированном
  // максимальном разрешении (см. RENDER_ZOOM_HEADROOM), а react-zoom-pan-
  // pinch поверх него просто визуально масштабирует через CSS transform.
  // offsetWidth — собственный (нетрансформированный) layout-размер
  // элемента, getBoundingClientRect().width — уже с учётом текущего
  // transform; отношение между ними и есть текущий видимый масштаб.
  const getDisplayScale = (): number => {
    const canvas = drawingCanvasRef.current;
    if (!canvas || canvas.offsetWidth === 0) return 1;
    return canvas.getBoundingClientRect().width / canvas.offsetWidth;
  };

  // Локальные координаты канваса рисования (не PDF-координаты) из
  // pointer-события — общая точка входа для пера и ластика. Переводим в
  // систему координат НАПЕЧЁННОГО (нетрансформированного) канваса — именно
  // в ней работает viewport.convertToPdfPoint ниже — иначе штрих рисуется
  // не под пальцем на любом зуме, кроме как раз напечённого.
  const localPointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const displayScale = getDisplayScale();
    return { x: (e.clientX - rect.left) / displayScale, y: (e.clientY - rect.top) / displayScale };
  };

  // Кратчайшее расстояние от точки до отрезка — для ластика: штрих
  // считается "задетым", если курсор прошёл ближе ERASER_HIT_RADIUS px от
  // ЛЮБОГО отрезка его полилинии, не только от вершин.
  const distanceToSegment = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    return Math.hypot(p.x - projX, p.y - projY);
  };

  // Точка старта протягивания хайлайтера — в локальных координатах канваса
  // (не PDF, не state — читается синхронно в handleDrawingPointerMove на
  // каждый pointermove, состояние per-gesture, не нужно триггерить рендер).
  const highlightStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleDrawingPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    activePointerIdsRef.current.add(e.pointerId);
    if (activePointerIdsRef.current.size > 1) {
      // Второй палец лёг на канвас — это pinch, а не протягивание
      // выделения/пера. Обрываем то, что успел начать первый палец, и не
      // начинаем ничего для второго — иначе оба пальца независимо тянут
      // свой прямоугольник/штрих (жалоба "вся страница в разных
      // прямоугольниках").
      isDrawingRef.current = false;
      setInProgressStroke(null);
      setInProgressHighlightRect(null);
      highlightStartRef.current = null;
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) return;
    const local = localPointFromEvent(e);
    if (!local) return;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);

    if (toolMode === 'pen') {
      isDrawingRef.current = true;
      const [pdfX, pdfY] = viewport.convertToPdfPoint(local.x, local.y);
      setInProgressStroke([{ x: pdfX, y: pdfY }]);
    } else if (toolMode === 'eraser') {
      isDrawingRef.current = true;
      erasedInGestureRef.current = new Set();
      eraseAtLocalPoint(local, getDisplayScale());
    } else if (toolMode === 'highlight') {
      isDrawingRef.current = true;
      highlightStartRef.current = local;
      setInProgressHighlightRect({ x: local.x, y: local.y, width: 0, height: 0 });
    }
  };

  const handleDrawingPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    if (activePointerIdsRef.current.size > 1) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const local = localPointFromEvent(e);
    if (!local) return;

    if (toolMode === 'pen') {
      const [pdfX, pdfY] = viewport.convertToPdfPoint(local.x, local.y);
      setInProgressStroke((prev) => (prev ? [...prev, { x: pdfX, y: pdfY }] : [{ x: pdfX, y: pdfY }]));
    } else if (toolMode === 'eraser') {
      eraseAtLocalPoint(local, getDisplayScale());
    } else if (toolMode === 'highlight') {
      const start = highlightStartRef.current;
      if (!start) return;
      setInProgressHighlightRect({
        x: Math.min(start.x, local.x),
        y: Math.min(start.y, local.y),
        width: Math.abs(local.x - start.x),
        height: Math.abs(local.y - start.y),
      });
    }
  };

  const handleDrawingPointerUp = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    activePointerIdsRef.current.delete(e.pointerId);
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    if (toolMode === 'pen' && inProgressStroke && inProgressStroke.length >= 2) {
      const points = inProgressStroke;
      setInProgressStroke(null);
      try {
        const created = await createDocumentDrawing(documentId, { pageNumber, points });
        setDrawings((prev) => [...prev, created]);
        undoStackRef.current.push({ kind: 'drawing', id: created.id });
        setCanUndo(true);
      } catch (err) {
        console.error('[PdfViewerModal] save drawing failed:', err);
        setError(err instanceof Error ? err.message : 'Не удалось сохранить штрих');
      }
    } else if (toolMode === 'highlight' && inProgressHighlightRect) {
      const rect = inProgressHighlightRect;
      const viewport = viewportRef.current;
      highlightStartRef.current = null;
      setInProgressHighlightRect(null);
      // Слишком маленький прямоугольник — случайный тап, не осмысленное
      // протягивание, не сохраняем.
      if (!viewport || rect.width < 4 || rect.height < 4) return;
      const [pdfX1, pdfY1] = viewport.convertToPdfPoint(rect.x, rect.y);
      const [pdfX2, pdfY2] = viewport.convertToPdfPoint(rect.x + rect.width, rect.y + rect.height);
      const rects: HighlightRect[] = [{
        x: Math.min(pdfX1, pdfX2),
        y: Math.min(pdfY1, pdfY2),
        width: Math.abs(pdfX2 - pdfX1),
        height: Math.abs(pdfY2 - pdfY1),
      }];
      try {
        const created = await createDocumentHighlight(documentId, { pageNumber, rects, color: selectedHighlightColor });
        setHighlights((prev) => [...prev, created]);
        undoStackRef.current.push({ kind: 'highlight', id: created.id });
        setCanUndo(true);
      } catch (err) {
        console.error('[PdfViewerModal] save highlight failed:', err);
        setError(err instanceof Error ? err.message : 'Не удалось сохранить выделение');
      }
    } else {
      setInProgressStroke(null);
      setInProgressHighlightRect(null);
    }
  };

  // "Отменить" — убирает последнее СОЗДАННОЕ в этом сеансе выделение/штрих
  // (не трогает то, что уже было на странице до открытия визарда). Раньше
  // единственный способ убрать неверный штрих пера был переключить
  // инструмент на ластик и обратно — прямая жалоба пользователя.
  const handleUndo = async () => {
    const last = undoStackRef.current.pop();
    if (!last) return;
    setCanUndo(undoStackRef.current.length > 0);
    try {
      if (last.kind === 'drawing') {
        await deleteDocumentDrawing(last.id);
        setDrawings((prev) => prev.filter((d) => d.id !== last.id));
      } else {
        await deleteDocumentHighlight(last.id);
        setHighlights((prev) => prev.filter((h) => h.id !== last.id));
      }
    } catch (err) {
      console.error('[PdfViewerModal] undo failed:', err);
      setError(err instanceof Error ? err.message : 'Не удалось отменить действие');
      // Реально не удалилось — возвращаем в стек, чтобы можно было
      // попробовать ещё раз, а не молча потерять возможность отмены.
      undoStackRef.current.push(last);
      setCanUndo(true);
    }
  };

  // Стирание — проверяет и штрихи пера, и цветные выделения текста (оба
  // рисуются/лежат ПОД canvas'ом рисования, который в режиме "Ластик"
  // перехватывает pointer-события первым — обычный onClick у
  // highlight-rect в этом режиме физически недостижим, поэтому ластик сам
  // отвечает за оба типа объектов на странице). Штрих задет, если курсор
  // прошёл ближе эффективного радиуса от любого его отрезка; highlight
  // задет, если курсор попал в один из его прямоугольников (с тем же
  // допуском по краям). Всё в координатах НАПЕЧЁННОГО канваса (см.
  // localPointFromEvent) — ERASER_HIT_RADIUS делим на displayScale, чтобы
  // хитбокс оставался постоянным в РЕАЛЬНЫХ (экранных) пикселях под
  // пальцем, а не в пикселях напечённого канваса — иначе на уменьшенном
  // (не 400%) зуме ластик промахивался бы гораздо чаще.
  // erasedInGestureRef не даёт повторно слать DELETE за тот же жест
  // протягивания, пока запрос на предыдущий ещё не устоялся в state.
  const eraseAtLocalPoint = (local: { x: number; y: number }, displayScale: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const radius = ERASER_HIT_RADIUS / displayScale;

    for (const drawing of drawings) {
      const key = `drawing:${drawing.id}`;
      if (erasedInGestureRef.current.has(key)) continue;
      const viewportPoints = drawing.points.map((p) => {
        const [vx, vy] = viewport.convertToViewportPoint(p.x, p.y);
        return { x: vx, y: vy };
      });
      let hit = false;
      for (let i = 0; i < viewportPoints.length - 1; i++) {
        if (distanceToSegment(local, viewportPoints[i], viewportPoints[i + 1]) <= radius) {
          hit = true;
          break;
        }
      }
      if (hit) {
        erasedInGestureRef.current.add(key);
        setDrawings((prev) => prev.filter((d) => d.id !== drawing.id));
        deleteDocumentDrawing(drawing.id).catch(() => {
          // Молча — штрих уже убран из UI, повторная синхронизация
          // произойдёт при следующей загрузке страницы (fetchDocumentDrawings).
        });
      }
    }

    for (const highlight of highlights) {
      const key = `highlight:${highlight.id}`;
      if (erasedInGestureRef.current.has(key)) continue;
      const hit = highlight.rects.some((rect) => {
        const [vx1, vy1] = viewport.convertToViewportPoint(rect.x, rect.y);
        const [vx2, vy2] = viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height);
        const left = Math.min(vx1, vx2) - radius;
        const right = Math.max(vx1, vx2) + radius;
        const top = Math.min(vy1, vy2) - radius;
        const bottom = Math.max(vy1, vy2) + radius;
        return local.x >= left && local.x <= right && local.y >= top && local.y <= bottom;
      });
      if (hit) {
        erasedInGestureRef.current.add(key);
        setHighlights((prev) => prev.filter((h) => h.id !== highlight.id));
        deleteDocumentHighlight(highlight.id).catch(() => {
          // Молча — то же соображение, что у штрихов пера выше.
        });
      }
    }
  };

  // Перерисовка canvas'а штрихов при смене набора/в процессе рисования —
  // canvas, не DOM-элементы (в отличие от highlight-прямоугольников),
  // потому что произвольная полилиния — это путь, а не набор
  // прямоугольников.
  useEffect(() => {
    const canvas = drawingCanvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = DRAWING_COLOR;
    ctx.lineWidth = DRAWING_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const strokePoints = (points: DrawingPoint[]) => {
      if (points.length < 2) return;
      ctx.beginPath();
      points.forEach((p, i) => {
        const [vx, vy] = viewport.convertToViewportPoint(p.x, p.y);
        if (i === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      });
      ctx.stroke();
    };

    drawings.forEach((d) => strokePoints(d.points));
    if (inProgressStroke) strokePoints(inProgressStroke);
  }, [drawings, inProgressStroke, pageNumber, pdfDoc, viewportVersion]);

  const numPages = pdfDoc?.numPages ?? 1;
  const viewport = viewportRef.current;

  return (
    <div className="pdf-viewer-overlay">
      <div className="pdf-viewer-panel">
        <div className="pdf-viewer-header">
          <p className="pdf-viewer-filename">{fileName}</p>
          <div className="pdf-viewer-toolbar">
            <button
              type="button"
              className={`pdf-viewer-tool-btn ${toolMode === 'pan' ? 'pdf-viewer-tool-btn--active' : ''}`}
              onClick={() => setToolMode('pan')}
              aria-label="Перемещение страницы"
              title="Стрелка"
            >
              <MousePointer2 size={18} strokeWidth={1.5} />
            </button>
            <div className="pdf-viewer-tool-btn-wrap" ref={highlightToolBtnWrapRef}>
              <button
                type="button"
                className={`pdf-viewer-tool-btn ${toolMode === 'highlight' ? 'pdf-viewer-tool-btn--active' : ''}`}
                onClick={() => {
                  if (toolMode === 'highlight') {
                    setIsColorPickerOpen((v) => !v);
                  } else {
                    setToolMode('highlight');
                    setIsColorPickerOpen(true);
                  }
                }}
                aria-label="Хайлайтер"
                title="Хайлайтер"
              >
                <Highlighter size={18} strokeWidth={1.5} />
                {/* Цветная полоска под иконкой — какой цвет выбран сейчас,
                    видно не открывая палитру. */}
                <span className="pdf-viewer-tool-btn-color-dot" style={{ background: selectedHighlightColor }} />
              </button>
              {isColorPickerOpen && (
                <div className="pdf-viewer-color-popup pdf-viewer-color-popup--toolbar">
                  {HIGHLIGHT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`pdf-viewer-color-swatch ${color === selectedHighlightColor ? 'pdf-viewer-color-swatch--active' : ''}`}
                      style={{ background: color }}
                      onClick={() => {
                        setSelectedHighlightColor(color);
                        setIsColorPickerOpen(false);
                      }}
                      aria-label={`Выбрать цвет ${color}`}
                    />
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className={`pdf-viewer-tool-btn ${toolMode === 'pen' ? 'pdf-viewer-tool-btn--active' : ''}`}
              onClick={() => setToolMode('pen')}
              aria-label="Перо"
              title="Перо"
            >
              <Pen size={18} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              className={`pdf-viewer-tool-btn ${toolMode === 'eraser' ? 'pdf-viewer-tool-btn--active' : ''}`}
              onClick={() => setToolMode('eraser')}
              aria-label="Ластик"
              title="Ластик"
            >
              <Eraser size={18} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              className="pdf-viewer-tool-btn"
              onClick={handleUndo}
              disabled={!canUndo}
              aria-label="Отменить"
              title="Отменить последнее действие"
            >
              <Undo2 size={18} strokeWidth={1.5} />
            </button>
          </div>
          <button type="button" className="pdf-viewer-close-btn" onClick={onClose} aria-label="Закрыть">
            <X size={24} strokeWidth={1.5} />
          </button>
        </div>

        <div className="pdf-viewer-body" ref={containerRef}>
          {isLoading && <p className="loading-message">Загрузка файла...</p>}
          {error && <p className="pdf-viewer-error">{error}</p>}
          {!isLoading && !error && (
            <TransformWrapper
              ref={transformRef}
              initialScale={MIN_LIB_SCALE}
              minScale={MIN_LIB_SCALE}
              maxScale={MAX_LIB_SCALE}
              initialPositionX={0}
              initialPositionY={0}
              limitToBounds
              // Одним пальцем (panning) — только в инструменте "Стрелка":
              // иначе одиночное касание в режиме Хайлайтер/Перо одновременно
              // пыталось бы и панорамировать страницу, и рисовать штрих. Два
              // пальца (pinch) — разрешены ВСЕГДА, в любом инструменте:
              // защиту от конфликта с рисованием уже даёт activePointerIdsRef
              // в канвасе рисования (как только ложится второй палец, текущий
              // штрих/выделение обрывается без сохранения) — поэтому зуму не
              // обязательно ждать переключения на "Стрелку", как было раньше
              // (жалоба "зум двумя пальцами с выбранным инструментом не
              // работает").
              panning={{ disabled: toolMode !== 'pan' }}
              pinch={{ disabled: false }}
              // По умолчанию у библиотеки выключен (disabled: true) — без
              // этого жест двумя пальцами по тачпаду (без зажатого Ctrl,
              // просто свайп) никак не обрабатывался, перемещение с
              // ноутбука работало только протягиванием через клик.
              trackPadPanning={{ disabled: toolMode !== 'pan' }}
              doubleClick={{ disabled: true }}
              // wheelDisabled — обычная прокрутка колесом мыши не зумирует
              // (неожиданно для десктопа); touchPadDisabled: false — зато
              // pinch на трекпаде (браузер шлёт его как wheel+ctrlKey)
              // перехватывается нами и зумирует ИМЕННО документ: раньше
              // wheel был выключен целиком, из-за чего событие не
              // гасилось (event.preventDefault() внутри библиотеки) и
              // браузер зумировал всю страницу приложения жестом трекпада.
              wheel={{ wheelDisabled: true, touchPadDisabled: false }}
              onZoomStop={handleGestureSettled}
              onPinchStop={handleGestureSettled}
            >
              <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
                <div
                  ref={pageWrapRef}
                  className={`pdf-viewer-page-wrap ${toolMode === 'pan' ? 'pdf-viewer-page-wrap--pan' : ''}`}
                >
                  <canvas ref={canvasRef} className="pdf-viewer-canvas" />
                  <div ref={textLayerRef} className="pdf-viewer-text-layer textLayer" />
                  <div ref={highlightLayerRef} className="pdf-viewer-highlight-layer">
                    {viewport && highlights.map((h) => (
                      <React.Fragment key={h.id}>
                        {h.rects.map((rect, i) => {
                          const [vx1, vy1] = viewport.convertToViewportPoint(rect.x, rect.y);
                          const [vx2, vy2] = viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height);
                          return (
                            <div
                              key={i}
                              className="pdf-viewer-highlight-rect"
                              style={{
                                left: Math.min(vx1, vx2),
                                top: Math.min(vy1, vy2),
                                width: Math.abs(vx2 - vx1),
                                height: Math.abs(vy2 - vy1),
                                background: h.color,
                              }}
                              onClick={() => setSelectedHighlightId(h.id)}
                            />
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </div>

                  {/* Отдельный canvas поверх highlight-слоя — активен (ловит
                      pointer-события) в режимах "Хайлайтер"/"Перо"/"Ластик", в
                      режиме "Стрелка" пропускает события насквозь (drag/пинч
                      обрабатывает TransformWrapper выше). */}
                  <canvas
                    ref={drawingCanvasRef}
                    className={`pdf-viewer-drawing-layer ${toolMode !== 'pan' ? 'pdf-viewer-drawing-layer--active' : ''} ${toolMode === 'eraser' ? 'pdf-viewer-drawing-layer--eraser' : ''}`}
                    onPointerDown={handleDrawingPointerDown}
                    onPointerMove={handleDrawingPointerMove}
                    onPointerUp={handleDrawingPointerUp}
                    onPointerLeave={handleDrawingPointerUp}
                  />

                  {inProgressHighlightRect && (
                    <div
                      className="pdf-viewer-highlight-rect pdf-viewer-highlight-rect--in-progress"
                      style={{
                        left: inProgressHighlightRect.x,
                        top: inProgressHighlightRect.y,
                        width: inProgressHighlightRect.width,
                        height: inProgressHighlightRect.height,
                        background: selectedHighlightColor,
                      }}
                    />
                  )}

                  {selectedHighlightId && (
                    <div className="pdf-viewer-highlight-actions">
                      <button type="button" className="pdf-viewer-highlight-delete-btn" onClick={() => handleDeleteHighlight(selectedHighlightId)}>
                        <Trash2 size={16} strokeWidth={1.5} />
                        Удалить выделение
                      </button>
                      <button type="button" className="pdf-viewer-text-link-btn" onClick={() => setSelectedHighlightId(null)}>
                        Отмена
                      </button>
                    </div>
                  )}
                </div>
              </TransformComponent>
            </TransformWrapper>
          )}
        </div>

        {!isLoading && !error && (
          <div className="pdf-viewer-footer">
            <div className="pdf-viewer-zoom-controls">
              <button
                type="button"
                className="pdf-viewer-zoom-btn"
                onClick={() => zoomStep(-1)}
                disabled={zoom <= MIN_ZOOM}
                aria-label="Уменьшить"
              >
                −
              </button>
              <p className="pdf-viewer-zoom-indicator">{Math.round(zoom * 100)}%</p>
              <button
                type="button"
                className="pdf-viewer-zoom-btn"
                onClick={() => zoomStep(1)}
                disabled={zoom >= MAX_ZOOM}
                aria-label="Увеличить"
              >
                +
              </button>
            </div>
            {numPages > 1 && (
              <div className="pdf-viewer-page-nav">
                <button
                  type="button"
                  className="pdf-viewer-nav-btn"
                  onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                  disabled={pageNumber <= 1}
                >
                  <ChevronLeft size={20} strokeWidth={1.5} />
                </button>
                <p className="pdf-viewer-page-indicator">{pageNumber} из {numPages}</p>
                <button
                  type="button"
                  className="pdf-viewer-nav-btn"
                  onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
                  disabled={pageNumber >= numPages}
                >
                  <ChevronRight size={20} strokeWidth={1.5} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
