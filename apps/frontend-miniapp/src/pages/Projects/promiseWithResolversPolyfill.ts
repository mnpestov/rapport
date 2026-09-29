// pdfjs-dist v6 использует Promise.withResolvers() (ES2024) в ~27 местах,
// включая конструктор TextLayer и сам воркер — без полифилла на движках
// без нативной поддержки (Safari < 17.4, старый встроенный WebKit в
// Telegram Desktop на macOS — воспроизведено на реальном устройстве:
// canvas рендерится, TextLayer падает с "undefined is not a function") PDF
// рендерится частично и тут же падает с ошибкой.
//
// Импортируется как первая строка в PdfViewerModal.tsx (основной поток) —
// для воркера тот же полифилл повторён отдельно в pdfWorkerEntry.ts,
// потому что Worker выполняется в изолированном глобальном контексте
// (self), сюда его не докинуть.
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
