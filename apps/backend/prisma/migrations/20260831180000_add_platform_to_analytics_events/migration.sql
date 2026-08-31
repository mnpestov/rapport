-- Признак платформы у аналитических событий (BROWSER_ACCESS_PLAN.md §4.5, P2).
--
-- Без него события браузерной версии неотличимы от Telegram, и воронка
-- смешивает две разные аудитории. Nullable: бэкфилл ниже проставляет
-- 'miniapp' всему, что было до появления веба — других источников тогда не
-- существовало.

-- AlterTable
ALTER TABLE "PatternLinkClick" ADD COLUMN     "platform" TEXT;

-- AlterTable
ALTER TABLE "PatternView" ADD COLUMN     "platform" TEXT;

-- AlterTable
ALTER TABLE "PaywallEvent" ADD COLUMN     "platform" TEXT;

-- AlterTable
ALTER TABLE "SearchQuery" ADD COLUMN     "platform" TEXT;

-- AlterTable
ALTER TABLE "SubscribeClick" ADD COLUMN     "platform" TEXT;


-- Бэкфилл истории: до этой миграции браузерной версии не было, значит все
-- накопленные события пришли из Mini App. Ставим явно, чтобы NULL означал
-- «неизвестно» только для будущих строк, а не для всей истории.
UPDATE "PatternView"      SET "platform" = 'miniapp' WHERE "platform" IS NULL;
UPDATE "PatternLinkClick" SET "platform" = 'miniapp' WHERE "platform" IS NULL;
UPDATE "SubscribeClick"   SET "platform" = 'miniapp' WHERE "platform" IS NULL;
UPDATE "SearchQuery"      SET "platform" = 'miniapp' WHERE "platform" IS NULL;
UPDATE "PaywallEvent"     SET "platform" = 'miniapp' WHERE "platform" IS NULL;
