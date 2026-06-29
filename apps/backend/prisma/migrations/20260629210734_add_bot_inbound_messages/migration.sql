-- CreateTable
CREATE TABLE "BotInboundMessage" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "messageType" TEXT NOT NULL,
    "text" TEXT,
    "fileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotInboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotInboundMessage_telegramId_idx" ON "BotInboundMessage"("telegramId");

-- CreateIndex
CREATE INDEX "BotInboundMessage_createdAt_idx" ON "BotInboundMessage"("createdAt");
