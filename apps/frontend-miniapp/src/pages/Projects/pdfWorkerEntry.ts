// Обёртка над pdf.worker.min.mjs — ставит полифилл Promise.withResolvers()
// в ГЛОБАЛЬНОМ КОНТЕКСТЕ ВОРКЕРА (self), затем импортирует настоящий
// воркер-код pdfjs-dist. Нужен отдельно от promiseWithResolversPolyfill.ts
// (тот патчит основной поток страницы) — Worker выполняется в изолированном
// self, не видит патчи основного потока. См. комментарий там же для
// подробностей, почему полифилл вообще нужен (Safari/WebKit без
// нативной поддержки Promise.withResolvers падает внутри самого воркера
// pdfjs с "undefined is not a function").
if (typeof (self as any).Promise.withResolvers !== 'function') {
  (self as any).Promise.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// Vite инлайнит этот динамический import в тот же worker-чанк — реальный
// pdf.worker.min.mjs исполняется как ES-модуль сразу после полифилла выше.
// @ts-expect-error — pdfjs-dist не поставляет типы для этого файла
// напрямую (только через собственный ?url-суффикс, для которого типы даёт
// vite/client); динамический import без суффикса типов не имеет.
import('pdfjs-dist/build/pdf.worker.min.mjs');
