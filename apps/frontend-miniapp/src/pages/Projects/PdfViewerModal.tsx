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

// Свайп-перелистывание страниц — порог по пути (px) и времени (ms), тот же
// принцип "быстро и далеко, не просто палец дрогнул", что у остальных
// жестов в проекте (см. SwipeToDelete.tsx). Вертикаль ограничиваем
// отдельно — иначе обычный вертикальный скролл/тряска руки засчитывались
// бы как горизонтальный свайп.
const SWIPE_MIN_DISTANCE = 60;
const SWIPE_MAX_TIME = 400;
const SWIPE_MAX_VERTICAL_RATIO = 0.5;
// Двухпальцевый свайп (см. handleSwipeTouchStart/Move/End) не может
// определить "это свайп или пинч-зум" по одному кадру — расстояние между
// пальцами естественным образом немного "гуляет" само по себе при боковом
// движении рукой, без всякого намерения зумировать. Поэтому решение
// откладывается до накопления однозначного сигнала: порог смещения (px) и
// порог относительного изменения расстояния между пальцами — кто из двух
// первым "набрал" свой порог, тот и определяет исход.
const SWIPE_DECISION_DIST_PX = 16;
const SWIPE_DECISION_RATIO = 0.36;

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

  // Плавная смена страниц (не мгновенная перерисовка канваса) — см.
  // useEffect рендера страницы ниже и .pdf-viewer-page-wrap--transitioning
  // в CSS.
  const [isPageReady, setIsPageReady] = useState(true);

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
  // это pinch (теперь разрешён в любом инструменте, см. pinch={{disabled:
  // false}} в JSX — пользователю нужно зумировать/двигать двумя пальцами,
  // не переключаясь на "Стрелку"), а не протягивание выделения/пера: без
  // этой проверки каждый палец pinch'а независимо тянул свой
  // прямоугольник/штрих — прямая причина жалобы "вся страница в разных
  // прямоугольниках".
  const activePointerIdsRef = useRef<Set<number>>(new Set());

  // Полная хронологическая история действий (создание И стирание) для
  // кнопки "Отменить" — без него единственный способ убрать неверный штрих
  // пера был переключить инструмент на ластик и обратно (жалоба
  // пользователя), а отменить само стирание ластиком было нечем вообще
  // (жалоба "разве undo не должен отменять действие ластика?").
  //
  // localId, не серверный id — серверный id меняется при каждом
  // восстановлении (erase-undo пересоздаёт запись заново, id новый), а
  // история ссылается на один и тот же ЛОГИЧЕСКИЙ элемент много раз (его
  // создание, потом стирание, может быть снова стирание после
  // восстановления и т.д.). idMapRef — localId → ТЕКУЩИЙ серверный id
  // (резолвится в момент отмены, не хранится статично в записи — иначе
  // "создание" после восстановления пыталось бы удалить уже не
  // существующий старый id и падало с 404, как было в первой версии этого
  // фикса). serverIdToLocalIdRef — обратный поиск для ластика (тот видит
  // только текущий серверный id стираемой записи).
  //
  // Каждая запись достаётся из истории и применяется РОВНО ОДИН РАЗ,
  // ничего не кладётся обратно при успехе — иначе порядок отмены сбивался:
  // "стёр элемент2, потом элемент1" → "Отменить" должно вернуть 1, затем 2,
  // затем убрать 2, затем убрать 1 (линейная история назад), а не
  // чередовать "восстановить/тут же удалить" для одного элемента, прежде
  // чем дойти до второго (жалоба пользователя с конкретным протоколом
  // нажатий, где порядок не совпал с ожидаемым).
  type UndoEntry =
    | { action: 'create'; kind: 'drawing' | 'highlight'; localId: string }
    | { action: 'erase'; kind: 'drawing'; localId: string; points: DrawingPoint[] }
    | { action: 'erase'; kind: 'highlight'; localId: string; rects: HighlightRect[]; color: string };
  const undoStackRef = useRef<UndoEntry[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const nextLocalIdRef = useRef(0);
  const idMapRef = useRef<Map<string, string>>(new Map()); // localId -> текущий серверный id
  const serverIdToLocalIdRef = useRef<Map<string, string>>(new Map()); // текущий серверный id -> localId

  // Начало свайпа для перелистывания страниц — см. handleSwipeTouchStart/
  // Move/End ниже. dist — расстояние между пальцами в момент старта (только
  // для двухпальцевого свайпа, см. комментарий там) — null для одного
  // пальца. decided — итог классификатора "свайп или зум" (см.
  // SWIPE_DECISION_DIST_PX/RATIO выше): 'pending' пока неясно (копим
  // сигнал, глушим жест от TransformWrapper), 'swipe' — решили в пользу
  // перелистывания (продолжаем глушить), 'pinch' — решили, что это зум
  // (больше НЕ глушим, отпускаем жест библиотеке с этого момента).
  const swipeStartRef = useRef<{ x: number; y: number; time: number; dist: number | null; decided: 'pending' | 'swipe' | 'pinch' } | null>(null);
  // Последняя известная точка свайпа — нужна отдельно от swipeStartRef,
  // потому что при двухпальцевом свайпе touchend не гарантирует, что ОБА
  // пальца окажутся в e.changedTouches одновременно (физически они редко
  // поднимаются в одну и ту же миллисекунду) — используем последнюю
  // середину между пальцами, которую успели увидеть в touchmove, а не
  // пытаемся дождаться событие с двумя одновременными touches.
  const swipeLastPointRef = useRef<{ x: number; y: number } | null>(null);

  // Блокировка скролла фонового окна (страницы проекта), пока открыт
  // полноэкранный просмотр PDF — без неё жесты внутри модалки (особенно
  // pinch/pan от react-zoom-pan-pinch) иногда протекали наружу, и
  // пользователь видел, что страница ПОД модалкой продолжает скроллиться
  // (жалоба: "ползунок вертикального скролла окна проекта постоянно
  // двигается").
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isOpen]);

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

    // "Contain", не "fit width" — 100% должно показывать всю страницу
    // целиком (и по ширине, и по высоте), а не только по ширине с
    // обрезкой/скроллом снизу (жалоба пользователя). Вычитаем padding
    // контейнера (.pdf-viewer-body) — clientWidth/Height его включают, а
    // реальная доступная area для страницы меньше на эти отступы.
    const container = containerRef.current;
    let availableWidth = container?.clientWidth ?? 350;
    let availableHeight = container?.clientHeight ?? 500;
    if (container) {
      const style = window.getComputedStyle(container);
      availableWidth -= parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      availableHeight -= parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    }
    const baseViewport = page.getViewport({ scale: 1 });
    const fitScale = Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height);
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
  // обязана открываться с зумом предыдущей), и сразу по центру (centerView,
  // не setTransform(0,0,...) — та версия прижимала страницу к левому
  // верхнему углу, а не центрировала её).
  //
  // isPageReady уводит страницу в opacity:0 ПЕРЕД тем, как менять её
  // содержимое (жалоба "дёргано" — раньше канвас просто мгновенно
  // перерисовывался новым содержимым без всякого перехода). Короткая пауза
  // в начале — даёт CSS-переходу реально скрыть старую страницу, прежде чем
  // мы её очистим и начнём рисовать новую: без паузы смена была бы видна
  // "сквозь" ещё не потускневший старый кадр.
  useEffect(() => {
    if (!pdfDoc) return;
    setSelectedHighlightId(null);
    setInProgressHighlightRect(null);
    setIsPageReady(false);
    let cancelled = false;

    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (cancelled) return;
      const page = await pdfDoc.getPage(pageNumber);
      if (cancelled) return;
      pageRef.current = page;
      await renderPage();
      if (cancelled) return;
      transformRef.current?.centerView(MIN_LIB_SCALE, 0);
      setZoom(MIN_ZOOM);
      setIsPageReady(true);
    })().catch((err) => {
      // Полный stack trace в консоли — err.message на минифицированном
      // коде сам по себе малополезен (см. промахнувшуюся первую гипотезу
      // про Promise.withResolvers в комментарии у полифиллов; реальной
      // причиной оказался for-await-of на ReadableStream в getTextContent).
      console.error('[PdfViewerModal] render page failed:', err);
      setError(err instanceof Error ? err.message : 'Не удалось отрисовать страницу');
    });

    return () => { cancelled = true; };
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

  // Гасит одно-пальцевое касание/клик мышью на канвасе рисования ДО того,
  // как react-zoom-pan-pinch успеет его увидеть (panning теперь включён в
  // любом инструменте — см. panning={{disabled: zoom <= MIN_ZOOM}} в JSX —
  // без этого гашения один палец в режиме "Хайлайтер"/"Перо" одновременно
  // и рисует, и двигает страницу: жалоба "страница двигается и рисуются
  // каракули"). ОБЯЗАТЕЛЬНО нативный addEventListener с {capture: true}, а
  // не React-проп onTouchStart/onMouseDown: react-zoom-pan-pinch слушает
  // touchstart/mousedown нативно прямо на своём wrapper-узле (ближе к
  // канвасу по DOM, чем React), и успевает сработать ПЕРЕД тем, как React
  // (единый делегирующий слушатель на корне) вообще вызовет наш
  // синтетический обработчик — stopPropagation() оттуда опаздывает.
  // Capture-фаза идёт сверху вниз ДО bubble-фазы библиотеки, поэтому
  // перехватывает надёжно независимо от этой гонки. Два пальца НЕ гасим
  // (условие touches.length === 1) — тогда это pinch, его обрабатывает
  // TransformWrapper, а рисование само обрывается через activePointerIdsRef.
  useEffect(() => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;

    const stopIfSingleTouch = (e: TouchEvent) => {
      if (e.touches.length === 1) e.stopPropagation();
    };
    const stopMouse = (e: MouseEvent) => e.stopPropagation();

    canvas.addEventListener('touchstart', stopIfSingleTouch, { capture: true, passive: false });
    canvas.addEventListener('touchmove', stopIfSingleTouch, { capture: true, passive: false });
    canvas.addEventListener('mousedown', stopMouse, { capture: true });

    return () => {
      canvas.removeEventListener('touchstart', stopIfSingleTouch, { capture: true } as EventListenerOptions);
      canvas.removeEventListener('touchmove', stopIfSingleTouch, { capture: true } as EventListenerOptions);
      canvas.removeEventListener('mousedown', stopMouse, { capture: true } as EventListenerOptions);
    };
    // Канвас пересоздаётся при открытии/загрузке документа (см. isLoading/
    // error в JSX) — переподключаем слушатели на новый DOM-узел каждый раз.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, error]);

  // Свайп перелистывания (handleSwipeTouchStart/Move/End) — та же история,
  // что чуть выше с канвасом рисования: это были React-пропсы onTouchStart/
  // Move/End на pageWrapRef, и stopPropagation() оттуда ТОЖЕ опаздывал
  // относительно нативного слушателя react-zoom-pan-pinch на его wrapper-
  // узле (ближе к pageWrapRef по DOM, чем единый делегирующий слушатель
  // React). Поэтому библиотека реально видела КАЖДЫЙ touchmove и честно
  // реагировала на реальные микро-колебания расстояния между пальцами при
  // обычном боковом свайпе — отсюда "микрозумирование", сколько бы ни
  // поднимали порог классификатора (жалоба: "сделал порог 100 — всё равно
  // зумирует"). Порог был ни при чём, stopPropagation просто не долетал.
  useEffect(() => {
    const wrap = pageWrapRef.current;
    if (!wrap) return;

    const onStart = (e: TouchEvent) => handleSwipeTouchStart(e);
    const onMove = (e: TouchEvent) => handleSwipeTouchMove(e);
    const onEnd = (e: TouchEvent) => handleSwipeTouchEnd(e);

    wrap.addEventListener('touchstart', onStart, { capture: true, passive: false });
    wrap.addEventListener('touchmove', onMove, { capture: true, passive: false });
    wrap.addEventListener('touchend', onEnd, { capture: true, passive: false });
    wrap.addEventListener('touchcancel', onEnd, { capture: true, passive: false });

    return () => {
      wrap.removeEventListener('touchstart', onStart, { capture: true } as EventListenerOptions);
      wrap.removeEventListener('touchmove', onMove, { capture: true } as EventListenerOptions);
      wrap.removeEventListener('touchend', onEnd, { capture: true } as EventListenerOptions);
      wrap.removeEventListener('touchcancel', onEnd, { capture: true } as EventListenerOptions);
    };
    // pageWrapRef пересоздаётся вместе с канвасом рисования (тот же
    // isLoading/error gate в JSX) — переподключаем на новый узел так же.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, error]);

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

  // Средняя точка между двумя пальцами (или координата одного пальца, если
  // он один) — общий способ измерить "где сейчас находится жест" что для
  // одно-, что для двухпальцевого свайпа.
  const swipeTouchPoint = (touches: React.TouchList | TouchList): { x: number; y: number } => {
    if (touches.length >= 2) {
      const a = touches[0];
      const b = touches[1];
      return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
    }
    const t = touches[0];
    return { x: t.clientX, y: t.clientY };
  };
  const swipeTouchDistance = (touches: React.TouchList | TouchList): number => {
    const a = touches[0];
    const b = touches[1];
    return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
  };

  // Перелистывание страниц свайпом — только на 100% зуме (zoom === MIN_ZOOM):
  // панорамировать и так некуда (страница ровно по контейнеру, limitToBounds
  // не даст сдвинуть), поэтому жест в этой зоне свободен под свайп, не
  // отбирает ничего у реального панорамирования зумленной страницы.
  // Один палец — в инструменте "Стрелка" (второй там не нужен — рисовать
  // нечем). Два пальца — в любом ДРУГОМ инструменте: один палец там занят
  // рисованием, поэтому свайп двумя пальцами — единственный доступный
  // способ перелистнуть страницу, не выходя из Хайлайтера/Пера/Ластика
  // (жалоба: "перелистывание не работает при выбранном другом инструменте
  // и свайпом двумя пальцами"). Расстояние между пальцами проверяем
  // отдельно (dist) — чтобы отличить свайп от pinch-зума (TransformWrapper
  // разрешает pinch в любом инструменте, см. pinch={{disabled:false}}):
  // если пальцы заметно сближаются/расходятся, это зум, не свайп —
  // отпускаем жест библиотеке как обычно.
  const handleSwipeTouchStart = (e: TouchEvent) => {
    const count = e.touches.length;
    const isEligible = zoom <= MIN_ZOOM && (
      (toolMode === 'pan' && count === 1) ||
      (toolMode !== 'pan' && count === 2)
    );
    if (!isEligible) {
      swipeStartRef.current = null;
      swipeLastPointRef.current = null;
      return;
    }
    const point = swipeTouchPoint(e.touches);
    swipeStartRef.current = {
      x: point.x,
      y: point.y,
      time: Date.now(),
      dist: count === 2 ? swipeTouchDistance(e.touches) : null,
      // Один палец — решать тут нечего, "зум" физически невозможен одним
      // пальцем, сразу считаем жест свайпом.
      decided: count === 2 ? 'pending' : 'swipe',
    };
    swipeLastPointRef.current = point;
  };

  const handleSwipeTouchMove = (e: TouchEvent) => {
    const start = swipeStartRef.current;
    if (!start) return;
    const count = e.touches.length;
    const expectedCount = toolMode === 'pan' ? 1 : 2;
    // Число пальцев изменилось посреди жеста (один уже подняли) — больше
    // не обновляем "последнюю точку", touchend сработает по тому, что
    // успели увидеть здесь в последний раз.
    if (count !== expectedCount) return;

    if (start.decided === 'pending') {
      const point = swipeTouchPoint(e.touches);
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      // Два независимых "счётчика уверенности" — у кого раньше наберётся
      // 1.0, тот и определяет исход. Сравнение именно с НАЧАЛЬНЫМ
      // расстоянием/точкой (не с предыдущим кадром) — иначе жест никогда
      // бы не набрал уверенность, если он колеблется туда-сюда мелкими
      // шагами на каждый кадр.
      const moveScore = Math.hypot(dx, dy) / SWIPE_DECISION_DIST_PX;
      const pinchScore = start.dist != null
        ? Math.abs(swipeTouchDistance(e.touches) / start.dist - 1) / SWIPE_DECISION_RATIO
        : 0;
      if (moveScore >= 1 || pinchScore >= 1) {
        start.decided = pinchScore > moveScore ? 'pinch' : 'swipe';
      }
    }

    if (start.decided === 'pinch') {
      // Решили, что это зум — больше не вмешиваемся, пускай
      // TransformWrapper обрабатывает жест сам с этого момента (он видел
      // исходный touchstart и так, промежуточные move просто не доходили).
      return;
    }

    swipeLastPointRef.current = swipeTouchPoint(e.touches);
    e.stopPropagation();
  };

  const handleSwipeTouchEnd = (e: TouchEvent) => {
    const start = swipeStartRef.current;
    const lastPoint = swipeLastPointRef.current;
    swipeStartRef.current = null;
    swipeLastPointRef.current = null;
    if (!start || !lastPoint || start.decided === 'pinch') return;
    const dx = lastPoint.x - start.x;
    const dy = lastPoint.y - start.y;
    const dt = Date.now() - start.time;
    if (Math.abs(dx) < SWIPE_MIN_DISTANCE) return;
    if (dt > SWIPE_MAX_TIME) return;
    if (Math.abs(dy) > Math.abs(dx) * SWIPE_MAX_VERTICAL_RATIO) return;
    e.stopPropagation();
    const total = pdfDoc?.numPages ?? 1;
    if (dx < 0) {
      setPageNumber((p) => Math.min(total, p + 1));
    } else {
      setPageNumber((p) => Math.max(1, p - 1));
    }
  };

  const handleDeleteHighlight = async (id: string) => {
    setSelectedHighlightId(null);
    const highlight = highlights.find((h) => h.id === id);
    try {
      await deleteDocumentHighlight(id);
      setHighlights((prev) => prev.filter((h) => h.id !== id));
      // Удаление этой кнопкой — такое же стирание, как ластиком: тоже
      // должно отменяться через "Отменить" (та же логика восстановления).
      if (highlight) {
        const localId = getOrCreateLocalId(id);
        idMapRef.current.delete(localId);
        serverIdToLocalIdRef.current.delete(id);
        undoStackRef.current.push({ action: 'erase', kind: 'highlight', localId, rects: highlight.rects, color: highlight.color });
        setCanUndo(true);
      }
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

  // Новый localId для свежесозданного штриха/выделения — см. комментарий
  // у UndoEntry/idMapRef выше.
  const makeLocalId = () => `local-${nextLocalIdRef.current++}`;

  // localId для УЖЕ существующей записи (по её текущему серверному id) —
  // заводит новую привязку, если её ещё не было (запись загружена с
  // сервера при открытии страницы и ни разу не трогалась в этом сеансе).
  // Нужно ластику/кнопке удаления: они видят только серверный id, но для
  // истории "Отменить" нужен стабильный localId, не меняющийся при
  // будущих восстановлениях.
  const getOrCreateLocalId = (serverId: string): string => {
    const existing = serverIdToLocalIdRef.current.get(serverId);
    if (existing) return existing;
    const localId = makeLocalId();
    serverIdToLocalIdRef.current.set(serverId, localId);
    idMapRef.current.set(localId, serverId);
    return localId;
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
        const localId = makeLocalId();
        idMapRef.current.set(localId, created.id);
        serverIdToLocalIdRef.current.set(created.id, localId);
        undoStackRef.current.push({ action: 'create', kind: 'drawing', localId });
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
        const localId = makeLocalId();
        idMapRef.current.set(localId, created.id);
        serverIdToLocalIdRef.current.set(created.id, localId);
        undoStackRef.current.push({ action: 'create', kind: 'highlight', localId });
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

  // "Отменить" — откатывает ОДНО действие из линейной истории назад,
  // ровно один раз за нажатие (ничего не кладёт обратно при успехе — это
  // принципиально: раньше восстановленный элемент получал свежую запись
  // "создание" НАВЕРХ стека, из-за чего при "стёр элемент2, потом элемент1"
  // порядок отмены сбивался — вместо "вернуть 1, вернуть 2, убрать 2,
  // убрать 1" получалось "вернуть 1, убрать 1, вернуть 2, убрать 2").
  // Текущий серверный id резолвится через idMapRef по localId записи, а не
  // хранится в самой записи — он меняется при каждом восстановлении
  // (erase-undo пересоздаёт запись заново), а история может ссылаться на
  // один и тот же логический элемент несколько раз подряд.
  const handleUndo = async () => {
    const last = undoStackRef.current.pop();
    if (!last) return;
    setCanUndo(undoStackRef.current.length > 0);
    try {
      if (last.action === 'create') {
        const currentId = idMapRef.current.get(last.localId);
        // Записи уже нет (например, стёрли ещё раз после восстановления, и
        // та более поздняя отмена уже обработана) — отменять нечего, не
        // показываем ошибку, молча пропускаем.
        if (!currentId) return;
        if (last.kind === 'drawing') {
          await deleteDocumentDrawing(currentId);
          setDrawings((prev) => prev.filter((d) => d.id !== currentId));
        } else {
          await deleteDocumentHighlight(currentId);
          setHighlights((prev) => prev.filter((h) => h.id !== currentId));
        }
        idMapRef.current.delete(last.localId);
        serverIdToLocalIdRef.current.delete(currentId);
      } else if (last.kind === 'drawing') {
        const restored = await createDocumentDrawing(documentId, { pageNumber, points: last.points });
        setDrawings((prev) => [...prev, restored]);
        idMapRef.current.set(last.localId, restored.id);
        serverIdToLocalIdRef.current.set(restored.id, last.localId);
      } else {
        const restored = await createDocumentHighlight(documentId, { pageNumber, rects: last.rects, color: last.color });
        setHighlights((prev) => [...prev, restored]);
        idMapRef.current.set(last.localId, restored.id);
        serverIdToLocalIdRef.current.set(restored.id, last.localId);
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
        const localId = getOrCreateLocalId(drawing.id);
        idMapRef.current.delete(localId);
        serverIdToLocalIdRef.current.delete(drawing.id);
        undoStackRef.current.push({ action: 'erase', kind: 'drawing', localId, points: drawing.points });
        setCanUndo(true);
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
        const localId = getOrCreateLocalId(highlight.id);
        idMapRef.current.delete(localId);
        serverIdToLocalIdRef.current.delete(highlight.id);
        undoStackRef.current.push({ action: 'erase', kind: 'highlight', localId, rects: highlight.rects, color: highlight.color });
        setCanUndo(true);
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
              // panning.disabled в этой библиотеке — один общий флаг сразу
              // и на мышь (десктоп), и на одно-пальцевый тач (мобила), и на
              // "можно ли двигать двумя пальцами ПОКА идёт pinch" — отдельно
              // друг от друга их не выключить через пропсы. Одиночное
              // касание/клик в режимах рисования гасим сами через
              // stopPropagation прямо на канвасе рисования (onMouseDown/
              // onTouchStart/onTouchMove ниже) — так мышь на десктопе
              // по-прежнему не двигает страницу во время рисования, а
              // телефон при этом получает желаемое: двумя пальцами можно
              // зумировать И двигать одновременно, не переключаясь на
              // "Стрелку" (allowPanning ниже — та самая "два пальца
              // двигают, не только зумируют" часть). Сам флаг — zoom <=
              // MIN_ZOOM: на 100% двигать и так нечего (contain-fit уже
              // показывает страницу целиком по центру), поэтому страница
              // не должна случайно сдвигаться, пока пользователь не
              // зумировал по-настоящему (прямой запрос "не двигать её до
              // зумирования").
              panning={{ disabled: zoom <= MIN_ZOOM }}
              pinch={{ disabled: false, allowPanning: true }}
              // disabled: true по умолчанию у библиотеки — без этого жест
              // двумя пальцами по тачпаду (без зажатого Ctrl, просто свайп)
              // никак не обрабатывался, перемещение с ноутбука работало
              // только протягиванием через клик. Тот же zoom <= MIN_ZOOM,
              // что и у panning — не двигать страницу трекпадом, пока не
              // зумировали.
              trackPadPanning={{ disabled: zoom <= MIN_ZOOM }}
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
                  className={`pdf-viewer-page-wrap ${toolMode === 'pan' ? 'pdf-viewer-page-wrap--pan' : ''} ${!isPageReady ? 'pdf-viewer-page-wrap--transitioning' : ''}`}
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
                      обрабатывает TransformWrapper выше). Гашение
                      одно-пальцевого/мышиного касания, чтобы оно не долетало
                      до TransformWrapper, — см. useEffect с нативными
                      capture-листенерами ниже (React-пропсы onTouchStart и
                      т.п. тут не работают, см. комментарий там). */}
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
