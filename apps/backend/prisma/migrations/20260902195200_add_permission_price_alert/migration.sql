-- Новое значение enum Permission — «Подписка на цены».
--
-- ОТДЕЛЬНЫЙ ФАЙЛ, только ADD VALUE. Postgres не даёт использовать новое
-- значение enum в той же транзакции, где оно добавлено, а Prisma оборачивает
-- файл миграции в транзакцию. Любой INSERT/UPDATE со значением 'PRICE_ALERT'
-- (в UserPermission через админку) идёт уже после этой миграции.
ALTER TYPE "Permission" ADD VALUE 'PRICE_ALERT';
