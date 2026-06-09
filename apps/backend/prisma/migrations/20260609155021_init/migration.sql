-- CreateTable
CREATE TABLE "Pattern" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "authorId" TEXT NOT NULL,

    CONSTRAINT "Pattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Author" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Author_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "ProductType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_PatternToProductType" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PatternToProductType_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_PatternToTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PatternToTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_InstrumentToPattern" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_InstrumentToPattern_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pattern_slug_key" ON "Pattern"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Author_name_key" ON "Author"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ProductType_name_key" ON "ProductType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_name_key" ON "Instrument"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "_PatternToProductType_B_index" ON "_PatternToProductType"("B");

-- CreateIndex
CREATE INDEX "_PatternToTag_B_index" ON "_PatternToTag"("B");

-- CreateIndex
CREATE INDEX "_InstrumentToPattern_B_index" ON "_InstrumentToPattern"("B");

-- AddForeignKey
ALTER TABLE "Pattern" ADD CONSTRAINT "Pattern_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Author"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PatternToProductType" ADD CONSTRAINT "_PatternToProductType_A_fkey" FOREIGN KEY ("A") REFERENCES "Pattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PatternToProductType" ADD CONSTRAINT "_PatternToProductType_B_fkey" FOREIGN KEY ("B") REFERENCES "ProductType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PatternToTag" ADD CONSTRAINT "_PatternToTag_A_fkey" FOREIGN KEY ("A") REFERENCES "Pattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PatternToTag" ADD CONSTRAINT "_PatternToTag_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_InstrumentToPattern" ADD CONSTRAINT "_InstrumentToPattern_A_fkey" FOREIGN KEY ("A") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_InstrumentToPattern" ADD CONSTRAINT "_InstrumentToPattern_B_fkey" FOREIGN KEY ("B") REFERENCES "Pattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;
