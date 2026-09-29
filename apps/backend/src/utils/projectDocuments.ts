import fs from "fs";
import path from "path";

/**
 * Валидация и хранение PDF-описаний проекта (PROJECTS_PLAN.md §8.1) —
 * единственный тип загрузки в проекте, где содержимое не проходит через
 * sharp (тот неявно валидирует, что байты декодируются как изображение;
 * для PDF эквивалента в пайплайне нет, поэтому сигнатура проверяется
 * явно здесь).
 */

export const MAX_PROJECT_DOCUMENTS = 5;
export const MAX_PROJECT_DOCUMENT_SIZE_BYTES = 20 * 1024 * 1024;

// Вне apps/backend/uploads/, которая примонтирована на express.static без
// авторизации — файл раздаётся только через авторизованный эндпоинт.
export const PROJECT_DOCUMENTS_DIR = path.join(__dirname, "../../private/project-documents");
fs.mkdirSync(PROJECT_DOCUMENTS_DIR, { recursive: true });

const PDF_SIGNATURE = Buffer.from("%PDF-");

// MIME/расширение из multipart легко подделать — сигнатура файла (первые
// байты) единственная надёжная проверка, что это действительно PDF, не
// просто файл с переименованным расширением.
export function hasPdfSignature(filePath: string): boolean {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(PDF_SIGNATURE.length);
    const bytesRead = fs.readSync(fd, buffer, 0, PDF_SIGNATURE.length, 0);
    return bytesRead === PDF_SIGNATURE.length && buffer.equals(PDF_SIGNATURE);
  } finally {
    fs.closeSync(fd);
  }
}
