// Полифиллы для старого встроенного WebKit (Telegram Desktop на macOS,
// подтверждено реальным stack trace: canvas рендерится, затем
// TypeError внутри pdf.mjs). Импортируется как первая строка в
// PdfViewerModal.tsx (основной поток) — для воркера тот же набор
// повторяется в pdfWorkerEntry.ts, потому что Worker выполняется в
// изолированном глобальном контексте (self), патч отсюда туда не долетает.

// 1) Promise.withResolvers() (ES2024) — используется в ~27 местах
// pdfjs-dist, включая конструктор TextLayer и сам воркер (Safari < 17.4).
if (typeof (Promise as any).withResolvers !== 'function') {
  (Promise as any).withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// 2) ReadableStream async iteration (`for await (const x of stream)`) —
// PageProxy.getTextContent() в pdf.mjs использует именно этот синтаксис
// (не полифилл pdfjs — часть спецификации Streams, добавленная в Safari/
// WebKit ощутимо позже, чем в Chrome/Firefox). БЕЗ полифилла:
// "TypeError: undefined is not a function (near '...i of e...')" — именно
// та ошибка, найденная по реальному stack trace (getTextContent — pdf.mjs
// строка 16040 `for await (const value of readableStream)`), которую не
// объясняла первая гипотеза про Promise.withResolvers (тот успевал
// отработать раньше — до getTextContent).
if (typeof (ReadableStream.prototype as any)[Symbol.asyncIterator] !== 'function') {
  (ReadableStream.prototype as any)[Symbol.asyncIterator] = async function* asyncIterator(this: ReadableStream) {
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
