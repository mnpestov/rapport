-- Новая модель для свободных штрихов пера в PDF-вьюере (PROJECTS_PLAN.md
-- §8.2) — отдельно от ProjectDocumentHighlight (тот хранит прямоугольники
-- текстового выделения, этот — произвольные рукописные линии).

-- CreateTable
CREATE TABLE "ProjectDocumentDrawing" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "points" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDocumentDrawing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectDocumentDrawing_documentId_idx" ON "ProjectDocumentDrawing"("documentId");

-- AddForeignKey
ALTER TABLE "ProjectDocumentDrawing" ADD CONSTRAINT "ProjectDocumentDrawing_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
