-- CreateTable
CREATE TABLE "AdminBotMessage" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "text" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentBy" TEXT,

    CONSTRAINT "AdminBotMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminBotMessage_telegramId_idx" ON "AdminBotMessage"("telegramId");

-- CreateIndex
CREATE INDEX "AdminBotMessage_sentAt_idx" ON "AdminBotMessage"("sentAt");
