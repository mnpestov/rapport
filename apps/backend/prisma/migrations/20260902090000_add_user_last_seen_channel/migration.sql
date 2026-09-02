-- Канал последнего входа пользователя: "tg" | "web" | NULL.
-- Nullable, без бэкфилла: у существующих строк остаётся NULL, в UI — «—».
ALTER TABLE "User" ADD COLUMN "lastSeenChannel" TEXT;
