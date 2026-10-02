-- StashSwatch: свободная текстовая заметка к образцу.
ALTER TABLE "StashSwatch" ADD COLUMN "note" TEXT;

-- ProjectSwatch: тип инструмента (симметрично StashSwatch.instrumentType)
-- и свободная текстовая заметка.
ALTER TABLE "ProjectSwatch" ADD COLUMN "instrumentType" TEXT;
ALTER TABLE "ProjectSwatch" ADD COLUMN "note" TEXT;
