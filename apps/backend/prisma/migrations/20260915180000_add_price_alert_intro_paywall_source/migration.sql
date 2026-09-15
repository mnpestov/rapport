-- Новое значение enum PaywallSource — разовый баннер "новая функция"
-- (подписка на цены) действующим платным подписчикам.
--
-- ОТДЕЛЬНЫЙ ФАЙЛ, только ADD VALUE. Postgres не даёт использовать новое
-- значение enum в той же транзакции, где оно добавлено, а Prisma оборачивает
-- файл миграции в транзакцию. Любой INSERT со значением
-- 'PRICE_ALERT_INTRO' (PaywallEvent.source) идёт уже после этой миграции.
ALTER TYPE "PaywallSource" ADD VALUE 'PRICE_ALERT_INTRO';
