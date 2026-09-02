-- Новое значение enum ApplicationStatus (self-serve логин автора).
--
-- ОТДЕЛЬНЫЙ ФАЙЛ, только ADD VALUE. Postgres не даёт использовать новое
-- значение enum в той же транзакции, где оно добавлено, а Prisma оборачивает
-- файл миграции в транзакцию. Колонка desiredLogin, частичный индекс и любые
-- запросы со значением 'DRAFT' идут СЛЕДУЮЩИМ файлом.
ALTER TYPE "ApplicationStatus" ADD VALUE 'DRAFT' BEFORE 'PENDING';
