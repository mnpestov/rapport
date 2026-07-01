-- CreateTable
CREATE TABLE "AdminChatState" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "lastReadAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminChatState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminChatState_telegramId_key" ON "AdminChatState"("telegramId");

-- CreateIndex
CREATE INDEX "AdminChatState_telegramId_idx" ON "AdminChatState"("telegramId");
