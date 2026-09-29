-- Заменяем implicit many-to-many (_InstrumentToProject) на явную
-- join-таблицу ProjectInstrument с полем sizeMm — размер инструмента
-- отдельно для каждого проекта (одна и та же вязальщица использует спицы
-- 2,75мм на одном проекте и 4мм на другом).

-- CreateTable
CREATE TABLE "ProjectInstrument" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "sizeMm" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectInstrument_pkey" PRIMARY KEY ("id")
);

-- Переносим существующие связи из implicit-таблицы, без размера (его в
-- старой модели не было) — 3 строки на момент миграции.
INSERT INTO "ProjectInstrument" ("id", "projectId", "instrumentId", "sizeMm", "createdAt")
SELECT gen_random_uuid()::text, "B", "A", NULL, CURRENT_TIMESTAMP
FROM "_InstrumentToProject";

-- DropTable (implicit many-to-many, больше не нужна)
DROP TABLE "_InstrumentToProject";

-- CreateIndex
CREATE UNIQUE INDEX "ProjectInstrument_projectId_instrumentId_key" ON "ProjectInstrument"("projectId", "instrumentId");

-- CreateIndex
CREATE INDEX "ProjectInstrument_instrumentId_idx" ON "ProjectInstrument"("instrumentId");

-- AddForeignKey
ALTER TABLE "ProjectInstrument" ADD CONSTRAINT "ProjectInstrument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInstrument" ADD CONSTRAINT "ProjectInstrument_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
