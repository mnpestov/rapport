# Кабинет автора — полный контекст реализации

> Обновлено: 2026-07-22 | Статус: Все этапы (0–5, backend и frontend) завершены

---

## 1. Суть фичи

Авторы (сущность `Author`, связанная с `User` через `User.authorId`) могут:
- Создавать черновики новых описаний и отправлять на модерацию
- Редактировать уже опубликованные описания через черновик

Админ:
- Видит очередь черновиков на модерации
- Апрувит (публикует/обновляет Pattern) или реджектит с комментарием
- Управляет ролями пользователей и привязывает авторов через user_cart модалку

---

## 2. Ключевые архитектурные решения

### Draft vs moderationStatus
Используется отдельная сущность `Draft` вместо поля `Pattern.moderationStatus`. Это позволяет:
- Хранить черновики для *редактирования* уже опубликованных описаний
- Не трогать `Pattern` до момента аппрува
- Вести аудит-лог (закрытые черновики не удаляются, ставится `closedAt`)

### Pattern ↔ Draft: 1:N с частичным уникальным индексом
`patternId` в `Draft` НЕ `@unique` — это позволяет иметь закрытые черновики в истории.

Ограничение «один активный черновик на описание» обеспечивается:
- На уровне приложения (проверка в `createEditDraft` и `createDraft`)
- Частичным уникальным индексом в БД:
  ```sql
  CREATE UNIQUE INDEX "Draft_active_patternId_key"
    ON "Draft"("patternId")
    WHERE "closedAt" IS NULL AND "patternId" IS NOT NULL;
  ```

### Draft.patternId семантика
- `patternId = null` → новое описание (предложение)
- `patternId ≠ null` → правка уже опубликованного описания

### Роли и разрешения (финальное решение)
UI показывает три роли: **User / Author / Admin**. Под капотом — таблица `UserPermission`:

| Роль в UI | Что происходит на бэкенде |
|-----------|--------------------------|
| User | `UserPermission[MINI_APP]` |
| Author | `UserPermission[MINI_APP, AUTHOR_CABINET]` + `User.authorId` обязателен |
| Admin | `User.role = ADMIN` (существующая логика без изменений) |

Управление ролями — через **user_cart модалку** в разделе Пользователи. Отдельного экрана управления разрешениями в MVP нет.

### IDOR-защита
Все write-ендпоинты `/author/*` проверяют `draft.authorId === currentUser.authorId`.

### Конфликт редактирования
`PATCH /admin/patterns/:id` возвращает 409, если есть активный черновик.
На фронте: кнопка редактирования Pattern задизейблена, если у него есть активный черновик.

### Загрузка изображений
Авторы используют существующий `/admin/upload` ендпоинт. Маршрут вынесен ДО глобального `requireAdmin` и защищён `requirePermissionOrAdmin(AUTHOR_CABINET)`.

### syncAuthor (важно)
`syncAuthor` используется только для импорта данных. В кабинете автора всегда используется `User.authorId` напрямую.

### Роутинг фронтенда
Раздельные пути. После логина проверяем permissions:
- `ADMIN` → `/patterns` (текущая админка)
- `AUTHOR_CABINET` → `/cabinet`
- ни то ни другое → 403

```
/login          → OTP-форма (общая)
/cabinet        → кабинет автора
/patterns       → существующая админка
```

**Фактическая реализация (отличается от исходной схемы выше):** отдельных урлов `/cabinet/drafts/new` и `/cabinet/drafts/:id` нет. Админка и кабинет автора рендерятся одним и тем же компонентом `apps/admin/src/pages/Patterns/Patterns.tsx` (проп `variant: "admin" | "author"`, переключается в `App.tsx`), создание и редактирование черновика/описания — через общую модалку внутри страницы `/cabinet`, а не через отдельные роуты.

---

## 3. Схема данных

### Новые enum
```prisma
enum DraftStatus {
  DRAFT      // черновик у автора
  PENDING    // отправлен на модерацию
  APPROVED   // принят (closedAt выставлен)
  REJECTED   // отклонён (автор может исправить и перепослать)
}

enum Permission {
  MINI_APP
  AUTHOR_CABINET
  ADMIN
}
```

### Изменения в существующих моделях
```prisma
// User:
authorId     String?  @unique
author       Author?  @relation("UserAuthor", fields: [authorId], references: [id])
permissions  UserPermission[]
closedDrafts Draft[]  @relation("DraftClosedBy")

// Author:
user   User?   @relation("UserAuthor")
drafts Draft[]

// Pattern:
drafts Draft[]

// Tag, ProductType, Instrument — каждый получил:
drafts Draft[]
```

### Новые модели
```prisma
model UserPermission {
  id         String     @id @default(uuid())
  userId     String
  user       User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  permission Permission
  @@unique([userId, permission])
}

model Draft {
  id                String      @id @default(uuid())
  patternId         String?
  pattern           Pattern?    @relation(fields: [patternId], references: [id])
  authorId          String
  author            Author      @relation(fields: [authorId], references: [id])
  status            DraftStatus @default(DRAFT)
  moderationComment String?
  title             String
  url               String
  imageUrl          String
  isFree            Boolean     @default(false)
  isNew             Boolean     @default(false)
  closedAt          DateTime?
  closedById        String?
  closedBy          User?       @relation("DraftClosedBy", fields: [closedById], references: [id])
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt
  tags        Tag[]
  categories  ProductType[]
  instruments Instrument[]
  @@index([patternId])
  @@index([authorId])
  @@index([status])
}
```

---

## 4. Миграция

Файл: `prisma/migrations/20260707000000_add_draft_userpermission/migration.sql`

Применение (НЕ `migrate dev` — он требует TTY):
```bash
# 1. Сгенерировать SQL
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > migration.sql

# 2. Применить
npx prisma db execute --file migration.sql --schema prisma/schema.prisma

# 3. Отметить как применённую
npx prisma migrate resolve --applied 20260707000000_add_draft_userpermission

# 4. Перегенерировать клиент
npx prisma generate
```

---

## 5. API ендпоинты

### Кабинет автора (`/author/*`)
Все маршруты требуют: `requireAuth` + `requirePermission(AUTHOR_CABINET)`

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/author/me` | Инфо об авторе (имя, кол-во описаний, черновиков) |
| GET | `/author/patterns` | Список описаний + черновиков автора (combined) |
| GET | `/author/drafts/:id` | Один черновик |
| POST | `/author/drafts` | Создать новый черновик |
| PATCH | `/author/drafts/:id` | Обновить черновик (только в статусе DRAFT) |
| POST | `/author/drafts/:id/submit` | Отправить на модерацию (DRAFT/REJECTED → PENDING) |
| POST | `/author/patterns/:id/edit` | Создать черновик для правки опубликованного |

### Расширения admin (`/admin/*`) — реализованные

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/admin/users/:id/link-author` | Привязать Author к User |
| GET | `/admin/drafts` | Список черновиков (фильтр по status) |
| GET | `/admin/drafts/:id` | Один черновик |
| POST | `/admin/drafts/:id/approve` | Апрувить (транзакция: создать/обновить Pattern + закрыть Draft) |
| POST | `/admin/drafts/:id/reject` | Реджектить с комментарием (`{ moderationComment: string }`) |
| GET | `/admin/permissions` | Список разрешений юзера |
| POST | `/admin/permissions` | Выдать разрешение |
| DELETE | `/admin/permissions/:userId/:permission` | Отозвать разрешение |
| GET | `/admin/users/:id` | Детальная карточка пользователя (все поля + role + author + subscription) |
| PATCH | `/admin/users/:id` | Обновить роль и/или привязку автора одним запросом (`{ role, authorId }`) |

`GET /admin/users` (список) дополнен полями `role`, `authorId`, `author.name` — используются в колонках «Роль» и «Имя автора» таблицы пользователей (`apps/admin/src/pages/Users/UserRow.tsx`).

### Изменения в существующих ендпоинтах
- `GET /auth/me` — возвращает `authorId` и `permissions[]` ✅
- `POST /admin/upload` — доступен авторам с `AUTHOR_CABINET` ✅
- `PATCH /admin/patterns/:id` — возвращает 409 при активном черновике ✅

---

## 6. Файловая структура (изменённые/новые файлы)

```
apps/backend/
├── prisma/
│   ├── schema.prisma                          # обновлён ✅
│   └── migrations/
│       └── 20260707000000_add_draft_userpermission/
│           └── migration.sql                  # новый ✅
├── src/
│   ├── index.ts                               # обновлён ✅
│   ├── controllers/
│   │   ├── adminController.ts                 # обновлён ✅
│   │   ├── authorController.ts                # новый ✅
│   │   ├── usersController.ts                 # обновлён ✅ (+role, +author в list; +getUserById, +updateUser)
│   │   └── webAuthController.ts               # обновлён ✅
│   ├── middlewares/
│   │   └── requirePermission.ts               # новый ✅
│   └── routes/
│       ├── admin.ts                           # обновлён ✅ (+GET/PATCH /users/:id)
│       └── author.ts                          # новый ✅
```

Фронтенд (`apps/admin/src/`): `pages/Patterns/Patterns.tsx` (общий компонент админки и кабинета автора), `pages/Patterns/ModerationCard.tsx`, `pages/Users/Users.tsx` + `UserRow.tsx`, `pages/Authors/Authors.tsx`, `App.tsx` (роутинг `/cabinet`).

---

## 7. Дизайн — финализированные экраны

Figma-файл: `9COGTtzDGVErNHED1K4wHE` (страница «Админка»)

### Кабинет автора (Этап 4) — `/cabinet/*`

**Автор_Все** (`191:8451`) — главный экран кабинета
- Sidebar: Описания / Профиль (скоро) / Статистика (скоро) + имя автора
- Табы: Все / Опубликовано / Черновик / На модерации / Отклонено
- Таблица описаний со статус-бейджами и иконками
- Кнопки: + Добавить описание / Опубликовать / Удалить
- Строка с REJECTED-черновиком показывает оранжевый баннер с комментарием модератора

**Автор_отклонено** (`191:8953`) — фильтрованный вид с только rejected

**Попап: Новое описание** (`173:6589`)
- Поля: Название* / Категория* / Новое / Бесплатное / Хар-ки / Автор (read-only) / Ссылка* / Инструмент / Толщина пряжи* / Плотность (петли × ряды) / Загрузить фото
- Кнопки: Закрыть / Сохранить / Отправить на модерацию

**Попап: Редактировать описание** (`173:6862`)
- Те же поля, кнопка «Изменить фото»

**Попап: Редактировать описание (rejected)** (`173:6964`)
- Оранжевый баннер с комментарием модератора вверху формы

### Расширения админки (Этап 5)

**На модерации** (`191:9344`) — таб в разделе Описания
- Карточный вид (не таблица): фото + все поля черновика
- Кнопки прямо на карточке: Опубликовать / Отклонить
- Нет diff-вида — только новые данные черновика

**Модал: Причина отклонения** (`202:7482`, Variant2)
- Текстовый инпут для комментария
- Кнопки: Закрыть / Отклонить
- Отправляет `POST /admin/drafts/:id/reject` с `{ moderationComment }`

**Авторы** (`205:7645`) — список авторов
- Колонки: Имя / Сайт / Кол-во описаний
- Кнопка редактирования → Модал «Редактирование автора» (`206:7967`): Имя + Сайт

**Пользователи** (`211:8073`) — расширенный список
- Колонки: Имя / Username / Роль / Имя автора / Последний вход / Избранное
- Роль отображается с цветом: Admin / Author / User
- Клик на карандаш → Модал user_cart (`228:9421`)

**Модал user_cart** (`228:9421`) — управление пользователем
- Секции: Основное / Устройство / Каталог / **Разрешения**
- Разрешения:
  - Роль: одиночный select (User / Author / Admin) отображается как чип
  - Имя автора: search-select — **видимо только при роли Author, обязательно**
- Кнопки: Закрыть / Сохранить → вызывает `PATCH /admin/users/:id` с `{ role, authorId }`

---

## 8. UX-решения (финализированные)

| Вопрос | Решение |
|--------|---------|
| Diff черновика в модерации | Не нужен. Только карточка с новыми данными |
| Активный черновик у Pattern | Кнопка редактирования **задизейблена** (не баннер) |
| Управление разрешениями | Через «Роль» в user_cart. Отдельного экрана нет |
| Привязка автора | В той же user_cart модалке, вместе с ролью |
| Вход автора | admin.rapport.su → OTP-логин → проверка permissions → редирект на /cabinet/ |
| «Кабинет автора» кнопка | Не нужна. Роутинг автоматический после логина |
| Поле «Имя автора» в user_cart | Появляется только при роли Author, обязательное |

---

## 9. Безопасность

- `DEV_BYPASS_ADMIN_AUTH=true` и `ALLOW_DEV_AUTH=true` — fatal error при `NODE_ENV=production`
- Rate limiting: 10 черновиков/час на userId (in-memory `RateLimiter` в authorController)
- IDOR: все write-ендпоинты проверяют `draft.authorId === req.user.authorId`
- Загрузка изображений: валидация типа и размера файла на `/admin/upload`
- Не логировать: BOT_TOKEN, GATEWAY_API_KEY, OTP-коды, `location.href`, `location.hash`
- `.env` не пушим на сервер — меняем через `nano` в терминале
- Изменения на сервере вносятся только руками через терминал (не через скрипты/агент)

---

## 10. Статус реализации

| Этап | Описание | Статус |
|------|----------|--------|
| 0 | DB schema (Draft, UserPermission, enums) | ✅ Завершён |
| 1 | Middleware (requirePermission) | ✅ Завершён |
| 2 | Backend: author controller + routes | ✅ Завершён |
| 3 | Backend: admin extensions (drafts + permissions) | ✅ Завершён |
| 4 | Frontend: кабинет автора (/cabinet) | ✅ Завершён (архитектура отличается от исходного плана — см. раздел 2) |
| 5 Backend | `GET /admin/users/:id`, `PATCH /admin/users/:id`, role/author в списке | ✅ Завершён (2026-07-10) |
| 5 Frontend | Расширения UI: user_cart, таб «На модерации», Авторы | ✅ Завершён |

### Этап 5 Backend — что сделано (2026-07-10)

**`apps/backend/src/controllers/usersController.ts`** — дополнен:
- `getUsers`: добавлены поля `role`, `authorId`, `author { id, name }` в select
- `getUserById` (новая): полная карточка пользователя для user_cart модала (`id`, `telegramId`, все поля профиля, `role`, `authorId`, `author`, `permissions[]`, `favoritesCount`)
- `updateUser` (новая): `PATCH /admin/users/:id` — принимает `{ role, authorId }`, атомарно обновляет в транзакции `User.role` + `User.authorId` + синхронизирует `UserPermission[AUTHOR_CABINET]` (upsert при role=AUTHOR, deleteMany при смене на другую роль)

**`apps/backend/src/routes/admin.ts`** — добавлены маршруты:
- `GET /admin/users/:id` → `getUserById`
- `PATCH /admin/users/:id` → `updateUser`

### Этап 5 Frontend — что сделано
- [x] Раздел Описания — таб «На модерации» с карточным видом: `Patterns.tsx` (`status === "moderation"`) рендерит `ModerationCard.tsx` — фото + поля черновика, кнопки «Опубликовать»/«Отклонить» на карточке, без diff-вида; модалка «Причина отклонения» с textarea → `POST /admin/drafts/:id/reject`
- [x] Раздел Пользователи — колонки «Роль» и «Имя автора»: `apps/admin/src/pages/Users/UserRow.tsx`
- [x] Модал user_cart — select роли + search-select автора + `PATCH /admin/users/:id`: `apps/admin/src/pages/Users/Users.tsx` (`PermissionsSection` внутри `UserModal`)
- [x] Раздел Авторы — модал редактирования (Имя + Сайт): `apps/admin/src/pages/Authors/Authors.tsx` (`handleOpenEdit`)

---

## 11. Технический стек

- Backend: Express + Prisma 7.x + PostgreSQL (`localhost:5434`, БД `knitting_catalog`)
- Prisma adapter: `@prisma/adapter-pg` с `PrismaClient({ adapter })`
- `prisma.config.ts`: `defineConfig` с `earlyAccess: true`
- Frontend: Vite + React SPA
- Monorepo: `/Users/mihailpestov/Desktop/dev/ai-dev/miniApp_UU/apps/`
- Auth mini-app: Telegram initData + JWT без роли
- Auth web/admin: OTP через Telegram + JWT с ролью
- `requireAdmin`: читает `User.role === ADMIN` из БД на каждый запрос (не доверяет JWT)
- Figma MCP: `plugin:figma:figma` через `~/.claude/mcp.json`, аккаунт `perkinsshannon7047`
