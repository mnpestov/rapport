-- CreateTable
CREATE TABLE "FiberType" (
    "id" TEXT NOT NULL,
    "baseFiber" TEXT NOT NULL,
    "subtype" TEXT,
    "grade" TEXT,
    "treatment" TEXT,
    "origin" TEXT,
    "displayName" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FiberType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YarnComposition" (
    "id" TEXT NOT NULL,
    "yarnId" TEXT NOT NULL,
    "fiberTypeId" TEXT NOT NULL,
    "percentage" INTEGER,

    CONSTRAINT "YarnComposition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiberType_displayName_key" ON "FiberType"("displayName");

-- CreateIndex
CREATE INDEX "FiberType_baseFiber_idx" ON "FiberType"("baseFiber");

-- CreateIndex
CREATE UNIQUE INDEX "YarnComposition_yarnId_fiberTypeId_key" ON "YarnComposition"("yarnId", "fiberTypeId");

-- AddForeignKey
ALTER TABLE "YarnComposition" ADD CONSTRAINT "YarnComposition_yarnId_fkey" FOREIGN KEY ("yarnId") REFERENCES "Yarn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YarnComposition" ADD CONSTRAINT "YarnComposition_fiberTypeId_fkey" FOREIGN KEY ("fiberTypeId") REFERENCES "FiberType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
