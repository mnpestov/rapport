-- Веб-сессии + подготовка к серверному энфорсменту подписки
-- (BROWSER_ACCESS_PLAN.md §3.11, §10 миграция 2).
--
-- Схемная часть ниже сгенерирована prisma migrate diff; вручную дописаны два
-- блока в конце: функциональный индекс lower(username) и отзыв легаси-сессий.

-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "sessionId" TEXT;

-- CreateTable
CREATE TABLE "WebSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subscriptionOk" BOOLEAN NOT NULL DEFAULT true,
    "lastSubscriptionCheckAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ip" TEXT,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "WebSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebSession_userId_idx" ON "WebSession"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_sessionId_idx" ON "RefreshToken"("sessionId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WebSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebSession" ADD CONSTRAINT "WebSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Дописано вручную (Prisma этого не выражает в schema-синтаксисе)
-- ---------------------------------------------------------------------------

-- OTP-вход резолвит пользователя по @username через
-- findFirst({ where: { username: { equals, mode: "insensitive" } } }), что в
-- Postgres компилируется в ILIKE и до сих пор шло сиквентальным сканом по
-- всей таблице User. Функциональный индекс по lower(username) — Prisma не
-- умеет объявлять такие в schema (прецедент: Draft_active_patternId_key).
--
-- Именно функциональный, в отличие от UserCredential.login: тот
-- нормализуется на запись и ему хватает обычного @unique, а username
-- приходит из Telegram как есть и нормализовать его мы не можем.
-- NOT UNIQUE: два User могут исторически иметь один и тот же username
-- (Telegram переиспользует освобождённые), резолв разводит их по lastSeenAt.
CREATE INDEX IF NOT EXISTS "User_username_lower_idx" ON "User" (lower("username"));

-- Отзыв легаси веб-сессий (BROWSER_ACCESS_PLAN.md §3.3 п.5, S1b).
--
-- /auth/verify-code смонтирован в проде и до сих пор выдавал 30-дневный
-- refresh-токен без всякой проверки подписки на канал; такие токены
-- принимаются всеми requireAuth-роутами. С этого коммита появляется
-- WebSession и серверный энфорсмент подписки, но уже выданные токены
-- WebSession не имеют и прошли бы мимо него — поэтому отзываем их разом.
--
-- Исключения: ADMIN и обладатели AUTHOR_CABINET — их сессии выданы
-- осознанно (админка, авторский кабинет), и разлогинивать их незачем:
-- к каталогу мини-аппа эти токены отношения не имеют.
UPDATE "RefreshToken" SET "revoked" = true, "revokedAt" = now()
WHERE "sessionId" IS NULL
  AND "revoked" = false
  AND "userId" NOT IN (SELECT "id" FROM "User" WHERE "role" = 'ADMIN')
  AND "userId" NOT IN (SELECT "userId" FROM "UserPermission" WHERE "permission" = 'AUTHOR_CABINET');

