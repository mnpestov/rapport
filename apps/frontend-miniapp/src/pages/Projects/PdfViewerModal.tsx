// Первая строка (до pdfjs-dist!) — Promise.withResolvers() полифилл для
// основного потока, см. комментарий в самом файле.
import './promiseWithResolversPolyfill';
import React, { useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Trash2, MousePointer2, Pen, Eraser } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

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
const ERASER_HIT_RADIUS = 10;

type ToolMode = 'select' | 'pen' | 'eraser';

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
  const [pendingSelection, setPendingSelection] = useState<{ rects: HighlightRect[]; anchorX: number; anchorY: number } | null>(null);
  const [selectedHighlightId, setSelectedHighlightId] = useState<string | null>(null);

  // Режим тулбара: "Выделение" (текущее поведение — выделение текста →
  // палитра цвета), "Перо" (рисование тонкой чёрной линии) и "Ластик"
  // (тап/протягивание по штриху удаляет его целиком).
  const [toolMode, setToolMode] = useState<ToolMode>('select');
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

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const highlightLayerRef = useRef<HTMLDivElement>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  const pageRef = useRef<PDFPageProxy | null>(null);
  const viewportRef = useRef<any>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const isDrawingRef = useRef(false);
  const erasedInGestureRef = useRef<Set<string>>(new Set());
  const toolModeRef = useRef<ToolMode>('select');
  toolModeRef.current = toolMode;

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

  // Рендер текущей страницы: canvas + текстовый слой. Пересоздаётся при
  // смене страницы или после первой загрузки документа.
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    setSelectedHighlightId(null);
    setPendingSelection(null);

    (async () => {
      const page = await pdfDoc.getPage(pageNumber);
      if (cancelled) return;
      pageRef.current = page;

      const containerWidth = containerRef.current?.clientWidth ?? 350;
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = containerWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });
      viewportRef.current = viewport;

      const canvas = canvasRef.current;
      const textLayerEl = textLayerRef.current;
      if (!canvas || !textLayerEl) return;

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      renderTaskRef.current?.cancel();
      const renderTask = page.render({ canvas, canvasContext: ctx, viewport } as any);
      renderTaskRef.current = renderTask;
      await renderTask.promise;
      if (cancelled) return;

      textLayerEl.innerHTML = '';
      textLayerEl.style.width = `${viewport.width}px`;
      textLayerEl.style.height = `${viewport.height}px`;
      textLayerEl.style.setProperty('--total-scale-factor', String(scale));

      const textContent = await page.getTextContent();
      if (cancelled) return;
      const textLayer = new TextLayer({
        textContentSource: textContent,
        container: textLayerEl,
        viewport,
      });
      await textLayer.render();

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
      if (cancelled) return;
      // Триггерит ре-рендер, чтобы JSX (который читает viewportRef.current
      // напрямую) точно перечитал уже готовый viewport — см. комментарий у
      // объявления viewportVersion выше. Без этого пометки, загруженные
      // ДО завершения этого эффекта, остаются невидимыми до случайного
      // следующего ре-рендера по другой причине.
      setViewportVersion((v) => v + 1);
    })().catch((err) => {
      // Временная диагностика — минифицированное сообщение об ошибке само
      // по себе бесполезно (мешает точные имена переменных), нужен полный
      // stack trace в консоли, чтобы найти реальную строку/фичу, на которой
      // падает движок. Убрать после того, как причина найдена.
      console.error('[PdfViewerModal] render page failed:', err);
      if (!cancelled) setError(err instanceof Error ? err.message : 'Не удалось отрисовать страницу');
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

  // Переключение инструмента сбрасывает незавершённые состояния других
  // инструментов — иначе застрявший pendingSelection от "Выделения" мог бы
  // всплыть поверх холста в режиме "Пера".
  useEffect(() => {
    setPendingSelection(null);
    setSelectedHighlightId(null);
    window.getSelection()?.removeAllRanges();
  }, [toolMode]);

  // Слушает выделение текста в текстовом слое — при непустом Range
  // конвертирует пиксельные прямоугольники (getClientRects) обратно в
  // координаты PDF-страницы через обратную матрицу viewport.
  useEffect(() => {
    if (!isOpen) return;
    const handleSelectionChange = () => {
      if (toolModeRef.current !== 'select') return;
      const selection = window.getSelection();
      const textLayerEl = textLayerRef.current;
      const viewport = viewportRef.current;
      if (!selection || selection.isCollapsed || !textLayerEl || !viewport || selection.rangeCount === 0) {
        return;
      }
      const range = selection.getRangeAt(0);
      if (!textLayerEl.contains(range.commonAncestorContainer)) return;

      const clientRects = Array.from(range.getClientRects());
      if (clientRects.length === 0) return;
      const containerRect = textLayerEl.getBoundingClientRect();

      const rects: HighlightRect[] = clientRects.map((r) => {
        const localX = r.left - containerRect.left;
        const localY = r.top - containerRect.top;
        const [pdfX1, pdfY1] = viewport.convertToPdfPoint(localX, localY);
        const [pdfX2, pdfY2] = viewport.convertToPdfPoint(localX + r.width, localY + r.height);
        return {
          x: Math.min(pdfX1, pdfX2),
          y: Math.min(pdfY1, pdfY2),
          width: Math.abs(pdfX2 - pdfX1),
          height: Math.abs(pdfY2 - pdfY1),
        };
      });

      const lastRect = clientRects[clientRects.length - 1];
      setPendingSelection({
        rects,
        anchorX: lastRect.right - containerRect.left,
        anchorY: lastRect.bottom - containerRect.top,
      });
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePickColor = async (color: string) => {
    if (!pendingSelection) return;
    const { rects } = pendingSelection;
    setPendingSelection(null);
    window.getSelection()?.removeAllRanges();
    try {
      const created = await createDocumentHighlight(documentId, { pageNumber, rects, color });
      setHighlights((prev) => [...prev, created]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить выделение');
    }
  };

  const handleDeleteHighlight = async (id: string) => {
    setSelectedHighlightId(null);
    try {
      await deleteDocumentHighlight(id);
      setHighlights((prev) => prev.filter((h) => h.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить выделение');
    }
  };

  // Локальные координаты канваса рисования (не PDF-координаты) из
  // pointer-события — общая точка входа для пера и ластика.
  const localPointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
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

  const handleDrawingPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
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
      eraseAtLocalPoint(local);
    }
  };

  const handleDrawingPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const local = localPointFromEvent(e);
    if (!local) return;

    if (toolMode === 'pen') {
      const [pdfX, pdfY] = viewport.convertToPdfPoint(local.x, local.y);
      setInProgressStroke((prev) => (prev ? [...prev, { x: pdfX, y: pdfY }] : [{ x: pdfX, y: pdfY }]));
    } else if (toolMode === 'eraser') {
      eraseAtLocalPoint(local);
    }
  };

  const handleDrawingPointerUp = async () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    if (toolMode === 'pen' && inProgressStroke && inProgressStroke.length >= 2) {
      const points = inProgressStroke;
      setInProgressStroke(null);
      try {
        const created = await createDocumentDrawing(documentId, { pageNumber, points });
        setDrawings((prev) => [...prev, created]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось сохранить штрих');
      }
    } else {
      setInProgressStroke(null);
    }
  };

  // Стирание — проверяет и штрихи пера, и цветные выделения текста (оба
  // рисуются/лежат ПОД canvas'ом рисования, который в режиме "Ластик"
  // перехватывает pointer-события первым — обычный onClick у
  // highlight-rect в этом режиме физически недостижим, поэтому ластик сам
  // отвечает за оба типа объектов на странице). Штрих задет, если курсор
  // прошёл ближе ERASER_HIT_RADIUS px от любого его отрезка; highlight
  // задет, если курсор попал в один из его прямоугольников (с тем же
  // допуском по краям). Всё в координатах канваса (пикселях), не PDF,
  // чтобы хитбокс оставался постоянным в пикселях независимо от масштаба.
  // erasedInGestureRef не даёт повторно слать DELETE за тот же жест
  // протягивания, пока запрос на предыдущий ещё не устоялся в state.
  const eraseAtLocalPoint = (local: { x: number; y: number }) => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    for (const drawing of drawings) {
      const key = `drawing:${drawing.id}`;
      if (erasedInGestureRef.current.has(key)) continue;
      const viewportPoints = drawing.points.map((p) => {
        const [vx, vy] = viewport.convertToViewportPoint(p.x, p.y);
        return { x: vx, y: vy };
      });
      let hit = false;
      for (let i = 0; i < viewportPoints.length - 1; i++) {
        if (distanceToSegment(local, viewportPoints[i], viewportPoints[i + 1]) <= ERASER_HIT_RADIUS) {
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
        const left = Math.min(vx1, vx2) - ERASER_HIT_RADIUS;
        const right = Math.max(vx1, vx2) + ERASER_HIT_RADIUS;
        const top = Math.min(vy1, vy2) - ERASER_HIT_RADIUS;
        const bottom = Math.max(vy1, vy2) + ERASER_HIT_RADIUS;
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
              className={`pdf-viewer-tool-btn ${toolMode === 'select' ? 'pdf-viewer-tool-btn--active' : ''}`}
              onClick={() => setToolMode('select')}
              aria-label="Выделение текста"
              title="Выделение"
            >
              <MousePointer2 size={18} strokeWidth={1.5} />
            </button>
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
          </div>
          <button type="button" className="pdf-viewer-close-btn" onClick={onClose} aria-label="Закрыть">
            <X size={24} strokeWidth={1.5} />
          </button>
        </div>

        <div className="pdf-viewer-body" ref={containerRef}>
          {isLoading && <p className="loading-message">Загрузка файла...</p>}
          {error && <p className="pdf-viewer-error">{error}</p>}
          {!isLoading && !error && (
            <div className="pdf-viewer-page-wrap">
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
                  pointer-события) только в режимах "Перо"/"Ластик", в
                  режиме "Выделение" пропускает события насквозь к
                  текстовому слою под собой (pointer-events:none в CSS по
                  умолчанию, класс -active снимает его). */}
              <canvas
                ref={drawingCanvasRef}
                className={`pdf-viewer-drawing-layer ${toolMode !== 'select' ? 'pdf-viewer-drawing-layer--active' : ''} ${toolMode === 'eraser' ? 'pdf-viewer-drawing-layer--eraser' : ''}`}
                onPointerDown={handleDrawingPointerDown}
                onPointerMove={handleDrawingPointerMove}
                onPointerUp={handleDrawingPointerUp}
                onPointerLeave={handleDrawingPointerUp}
              />

              {pendingSelection && (
                <div
                  className="pdf-viewer-color-popup"
                  style={{ left: pendingSelection.anchorX, top: pendingSelection.anchorY }}
                >
                  {HIGHLIGHT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className="pdf-viewer-color-swatch"
                      style={{ background: color }}
                      onClick={() => handlePickColor(color)}
                      aria-label={`Выделить цветом ${color}`}
                    />
                  ))}
                </div>
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
          )}
        </div>

        {!isLoading && !error && numPages > 1 && (
          <div className="pdf-viewer-footer">
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
    </div>
  );
};
