-- Логин, выбранный пользователем при подаче заявки на кабинет автора.
-- Nullable: у заявок, поданных до этого изменения, останется NULL — approve
-- для них придумывает логин из имени, как раньше.
ALTER TABLE "AuthorApplication" ADD COLUMN "desiredLogin" TEXT;

-- Частичный уникальный индекс: не больше одной "открытой" заявки на
-- пользователя. DRAFT включён, чтобы нельзя было накопить несколько
-- недозаполненных черновиков (каждый держит логин). Заменяет прежний
-- индекс, покрывавший только PENDING.
DROP INDEX IF EXISTS "AuthorApplication_pending_userId_key";
CREATE UNIQUE INDEX "AuthorApplication_open_userId_key"
  ON "AuthorApplication"("userId")
  WHERE status IN ('DRAFT', 'PENDING');

-- Ускоряет поиск занятости логина среди живых заявок и подбор брошенных
-- черновиков фоновой задачей.
CREATE INDEX "AuthorApplication_desiredLogin_idx" ON "AuthorApplication"("desiredLogin");
