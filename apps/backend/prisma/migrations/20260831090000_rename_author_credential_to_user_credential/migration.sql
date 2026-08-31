-- Rename AuthorCredential -> UserCredential (BROWSER_ACCESS_PLAN.md §3.1, решение A1).
--
-- НАПИСАНО ВРУЧНУЮ, НЕ автогенерённый `prisma migrate dev` diff. Prisma не
-- распознаёт переименование модели и сгенерировала бы DROP TABLE + CREATE
-- TABLE — то есть потерю всех учётных записей. Здесь только ALTER ... RENAME,
-- данные остаются на месте.
--
-- Имена constraint'ов переименовываются явно: Prisma выводит их из имени
-- таблицы, и на них завязаны P2002-хендлеры в коде
-- (authorCredentialController.ts, authorApplicationController.ts) — если
-- оставить старые имена, следующий `migrate dev` попытается их пересоздать,
-- а обработчики конфликта логина продолжат искать подстроку "AuthorCredential".

ALTER TABLE "AuthorCredential" RENAME TO "UserCredential";

ALTER TABLE "UserCredential" RENAME CONSTRAINT "AuthorCredential_pkey" TO "UserCredential_pkey";
ALTER TABLE "UserCredential" RENAME CONSTRAINT "AuthorCredential_userId_fkey" TO "UserCredential_userId_fkey";

ALTER INDEX "AuthorCredential_userId_key" RENAME TO "UserCredential_userId_key";
ALTER INDEX "AuthorCredential_login_key" RENAME TO "UserCredential_login_key";

-- Нормализация существующих логинов к нижнему регистру: с этого момента код
-- пишет и ищет login только в lower (BROWSER_ACCESS_PLAN.md §4.1).
-- Текущие логины машинные (generateSlug -> уже lowercase), поэтому UPDATE
-- фактически no-op, но выполняется ради инварианта — иначе один заведённый
-- вручную логин с заглавной буквой стал бы недоступен для входа.
UPDATE "UserCredential" SET "login" = lower("login") WHERE "login" <> lower("login");
