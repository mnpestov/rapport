// Обёртка над pdf.worker.min.mjs — ставит те же полифиллы, что
// promiseWithResolversPolyfill.ts, но В ГЛОБАЛЬНОМ КОНТЕКСТЕ ВОРКЕРА
// (self), затем импортирует настоящий воркер-код pdfjs-dist. Нужен
// отдельно от того файла (тот патчит только основной поток страницы) —
// Worker выполняется в изолированном self, патчи основного потока туда не
// долетают. Подробное обоснование обоих полифиллов — там же.
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

if (typeof ((self as any).ReadableStream.prototype)[Symbol.asyncIterator] !== 'function') {
  (self as any).ReadableStream.prototype[Symbol.asyncIterator] = async function* asyncIterator(this: ReadableStream) {
    const reader = this.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
}

// Vite инлайнит этот динамический import в тот же worker-чанк — реальный
// pdf.worker.min.mjs исполняется как ES-модуль сразу после полифилла выше.
// @ts-expect-error — pdfjs-dist не поставляет типы для этого файла
// напрямую (только через собственный ?url-суффикс, для которого типы даёт
// vite/client); динамический import без суффикса типов не имеет.
import('pdfjs-dist/build/pdf.worker.min.mjs');
