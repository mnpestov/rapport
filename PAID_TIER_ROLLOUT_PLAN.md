# План коммита/деплоя платного тарифа — v3

Документ только для планирования. Кода в проекте не меняет — фиксирует анализ,
порядок действий и конкретные фрагменты кода, которые предстоит внести на
этапе реализации (не сейчас).

v2 разобрали повторно — ниже закрыты все 6 найденных дыр, с явным указанием,
что именно изменилось и почему.

---

## 0. Сквозной принцип (не изменился с v2)

**Данные (`price`, `oldPrice`, `details`, полный `images[]`) не должны физически
появляться в БД для видимых пользователю паттернов раньше, чем готов слой
чтения с проверкой роли.** Из этого принципа вытекает и порядок шагов в
разделе 4, и то, что Group A (скрипты парсинга) — не нейтральный тулинг: она
пишет ровно те данные, которые нужно гейтить, поэтому *пользоваться* ей на
проде (кнопка "Проверить новинки") можно только после готовности гейта, хотя
*коммитить* её код — можно в любой момент.

---

## 1. Что исправлено по разбору v2

| № | Проблема из разбора | Что сделано |
|---|---|---|
| 1 | Порядок Group C раньше Group B — `syncController.ts` физически зависит от полей схемы, которых ещё нет | Group B и Group C объединены в один шаг (раздел 4, шаг 2). Явное правило добавлено ниже. |
| 2 | Вывод про дубли был сильнее, чем проверка (2 из 5 URL сверены, остальные — нет) | Пользователь удалил дубли на проде вручную; перепроверено вживую — `GROUP BY url HAVING count(*) > 1` на проде возвращает 0 строк. Риск снят фактом, а не текстовым сравнением стейтментов (та проверка отвечала не на тот вопрос — см. раздел 2.1). |
| 3 | `resolveRole` на `filters.ts` без надобности в этом релизе | Убрано из шага 4 текущего релиза — `filters.ts` сейчас не отдаёт и не принимает ничего ценового. Возвращено в раздел 5 (когда дойдёт очередь до п.7). |
| 4 | Битая ссылка 2.4 → 2.6 (должна быть → 3.1) | Исправлено. |
| 5 | DB-lookup роли на каждый запрос — не оценена нагрузка на горячий путь | Добавлен in-process TTL-кэш (30 сек) поверх lookup — конкретный код в разделе 3.1. |
| 6 | Не учтён downtime многошагового деплоя на единственной прод-машине | Явно зафиксировано как факт (раздел 4, преамбула) + число шагов уменьшено объединением B+C. |

---

## 2. Правило про порядок Group B / Group C (закрывает дыру №1)

**Общее правило: любой backend-код, который в Prisma-запросе ссылается на поле
модели, добавленное новой миграцией, не может быть задеплоен раньше самой
миграции.** Конкретно здесь: незакоммиченный `syncController.ts` в
`processSyncBatch` делает

```ts
await prisma.pattern.create({
  data: {
    // ...
    details: parsedData.details ?? null,
    price: parsedData.price ?? null,
    oldPrice: parsedData.oldPrice ?? null,
    // ...
  },
});
```

Если это задеплоить раньше миграций из Group B — либо не соберётся TS (если
`schema.prisma` не уехал вместе с кодом), либо упадёт в рантайме на первом же
"Проверить новинки" с `column "details" of relation "Pattern" does not exist`
(если схема уехала, а `prisma migrate deploy` на проде — ещё нет). Поэтому в
разделе 4 шаги "миграции" и "админка" объединены в один шаг деплоя — раньше
были отдельными (2 и 3), теперь один (2).

### 2.1. Дубли по `url` — статус на проде (закрывает дыру №2)

Апдейт: пользователь вручную удалил дубли на проде. Перепроверено вживую
только что:

```sql
SELECT url, count(*) FROM "Pattern" GROUP BY url HAVING count(*) > 1;
-- 0 rows
```

На проде дублей по `url` в `Pattern` больше нет — риск "один `UPDATE ... WHERE
url = X` из `prod_details_price_backfill.sql` заденет две разные строки"
для прода снят полностью, не частично.

Важная оговорка методологии (для протокола, чтобы не повторить ту же ошибку
после следующей генерации файла): изначальная проверка в этом разделе
сравнивала **текст** сгенерированных `UPDATE`-стейтментов для одного `url`
("оба стейтмента идентичны байт-в-байт"). Это не отвечает на настоящий вопрос
риска. Генератор детерминирован — конечно, два стейтмента для одного и того же
`url`-ключа будут текстуально совпадать, это ничего не говорит о том,
**один ли это товар в двух дублирующихся строках `Pattern`, или два РАЗНЫХ
товара, которым по ошибке присвоили одинаковый `url`.** Только во втором
случае `WHERE url = X` реально портит данные — и именно это стоило проверять
через `SELECT id, title, "authorId" FROM "Pattern" WHERE url = X` по обеим
дублирующимся строкам, а не через сравнение текста двух `UPDATE`-стейтментов.
Сейчас это уже не актуально (дублей нет), но правило остаётся: если дубли
появятся снова (например, `author_sync.py` создаст новый дубль до чистки),
сверять нужно **содержимое дублирующихся строк `Pattern` в БД**, а не текст
стейтментов бэкофилла.

Дубли локально (найдены на локальной копии, count>1 по `url`, не пересекаются
1:1 со списком выше) до сих пор не убраны — но они не влияют на прод-бэкофилл
(файл гоняется на проде, не локально); почистить их или нет — вопрос гигиены
локальной БД, не блокер для этого плана.

Остаётся в силе независимо от этой находки: обязательный dry-run
(`BEGIN/ROLLBACK`) + `pg_dump`-бэкап перед реальным `COMMIT` на проде (раздел
4, шаг 5) — стандартная дисциплина для bulk UPDATE вне зависимости от того,
что показала проверка дублей.

---

## 3. Механизм гейтинга — конкретные файлы и код

### 3.1. Backend

#### Новый файл: `apps/backend/src/utils/patternVisibility.ts`

Общая точка правды для того, какие поля `Pattern` — платные. Импортируется и
контроллером паттернов, и (в будущем, раздел 5) контроллером фильтров — чтобы
список платных полей не разъезжался по файлам.

```ts
import { UserRole } from "@prisma/client";

// Единственное место, где перечислены "платные" поля Pattern — если тариф
// расширится, менять только здесь, а не в каждом контроллере отдельно.
export const PATTERN_PREMIUM_OMIT = {
  price: true,
  oldPrice: true,
  details: true,
} as const;

export const isAdminRole = (role: UserRole | null | undefined): boolean =>
  role === UserRole.ADMIN;
```

#### Новый файл: `apps/backend/src/middlewares/resolveRole.ts`

```ts
import { Request, Response, NextFunction } from "express";
import { UserRole } from "@prisma/client";
import { prisma } from "../prismaClient";

declare global {
  namespace Express {
    interface Request {
      userRole?: UserRole | null;
    }
  }
}

// Роль намеренно НЕ читаем из JWT (см. PAID_TIER_ROLLOUT_PLAN.md §2.3 в v2) —
// access-токен мини-аппа живёт до 24ч, refresh — до 30 дней, значит claim в
// токене отражал бы понижение/снятие роли только после переавторизации.
// Свежий (в пределах TTL) поход в БД даёт эффект за секунды — важно для
// тестирования, когда роль меняют туда-сюда вручную через админку.
const ROLE_CACHE_TTL_MS = 30_000;
const roleCache = new Map<string, { role: UserRole | null; expiresAt: number }>();

export const resolveRole = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    req.userRole = null;
    return next();
  }

  const cached = roleCache.get(req.user.userId);
  if (cached && cached.expiresAt > Date.now()) {
    req.userRole = cached.role;
    return next();
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { role: true },
    });
    req.userRole = user?.role ?? null;
  } catch {
    // Не блокируем запрос из-за сбоя резолвинга роли — просто трактуем как
    // обычного пользователя (безопасный дефолт: меньше доступа, не больше).
    req.userRole = null;
  }

  roleCache.set(req.user.userId, { role: req.userRole, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
  next();
};
```

`req.user` в этот момент уже гарантированно резолвлен — `softAuth` навешан
глобально в `index.ts:58` (`app.use(softAuth)`), Express выполняет
app-level мидлвары раньше router-level, значит явно ссылаться на `softAuth`
в `routes/patterns.ts` не нужно.

Кэш — простой `Map` в памяти процесса, без Redis (в проекте сейчас нет
кэш-инфраструктуры вообще — проверил `package.json`/грепом по `src`). TTL 30
секунд снимает нагрузку с БД на скролл каталога (пагинация дёргает
`GET /patterns` многократно за секунды), а промоут/демоут роли для теста
подействует не мгновенно, но за секунды, а не за дни — приемлемый компромисс.
Особенность: кэш общий на все pm2-инстансы? Нет — `pm2 jlist` на проде
показал `rapport-api` в единственном экземпляре (не кластер), значит
per-process `Map` достаточно; если когда-нибудь появится кластер-режим — кэш
нужно будет вынести во внешнее хранилище, но сейчас это не требуется.

#### Изменить: `apps/backend/src/routes/patterns.ts`

```diff
 import { Router } from "express";
 import { getPatterns, getPatternById, getPatternsByIds, getSimilarPatterns } from "../controllers/patternsController";
+import { resolveRole } from "../middlewares/resolveRole";

 const router = Router();

+router.use(resolveRole);
+
 router.get("/", getPatterns);
 router.post("/batch", getPatternsByIds);
 router.get("/:id/similar", getSimilarPatterns);
 router.get("/:id", getPatternById);

 export default router;
```

**`routes/filters.ts` в этом релизе НЕ трогаем** (закрывает дыру №3) —
`getFilters` сейчас не возвращает и не принимает ничего ценового, `resolveRole`
там сегодня не нужен и добавил бы лишний DB-запрос на каждый вызов фильтров
без всякой пользы. Вернуться к этому файлу — раздел 5, когда будет
реализовываться фильтр по цене (п.7).

#### Изменить: `apps/backend/src/controllers/patternsController.ts`

Текущее состояние (незакоммиченный локальный диф) уже омитит `images`+`details`
в трёх ручках из четырёх, но **нигде не омитит `price`/`oldPrice`** — это
отдельная, до сих пор не отмеченная дыра в самих данных (не в порядке
деплоя): без правки ниже `price`/`oldPrice` утекут всем через `getPatterns`,
`getPatternsByIds` и `getSimilarPatterns`, даже если бы деплой шёл в правильном
порядке. Правка ниже закрывает это заодно с основным гейтом.

```diff
 import { Request, Response } from "express";
 import { prisma } from "../prismaClient";
 import { buildPatternWhere } from "../utils/patternFilters";
+import { PATTERN_PREMIUM_OMIT, isAdminRole } from "../utils/patternVisibility";

 // ... mapPatternListItem без изменений ...

 export const getPatterns = async (req: Request, res: Response) => {
   try {
     // ...
+    const admin = isAdminRole(req.userRole);
     const [patterns, total] = await Promise.all([
       prisma.pattern.findMany({
         where,
         take,
         skip,
         orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
-        omit: { images: true, details: true },
+        omit: { images: true, ...(admin ? {} : PATTERN_PREMIUM_OMIT) },
         include: { author: true, instruments: true, categories: true, tags: true }
       }),
       prisma.pattern.count({ where })
     ]);
```

То же самое (замена `omit: { images: true, details: true }` на
`omit: { images: true, ...(admin ? {} : PATTERN_PREMIUM_OMIT) }` с
предварительным `const admin = isAdminRole(req.userRole);`) — в
`getPatternsByIds` и в `fetchSimilar` внутри `getSimilarPatterns`.

`getPatternById` — единственная ручка без `omit` вообще, и единственная, где
нужно ещё и подрезать `images` до одной обложки для не-админа (полный омит
здесь не подходит — фронту нужен хотя бы `imageUrl`/один элемент массива для
рендера, `ImageCarousel` сам схлопывается в одиночную картинку при
`images.length <= 1`, отдельно фронт трогать не нужно):

```diff
 export const getPatternById = async (req: Request, res: Response) => {
   try {
     const { id } = req.params;
+    const admin = isAdminRole(req.userRole);
     const pattern = await prisma.pattern.findFirst({
       where: { id, isVisible: true },
+      omit: admin ? {} : PATTERN_PREMIUM_OMIT,
       include: { author: true, instruments: true, categories: true, tags: true, yarnRanges: { select: { label: true } } }
     });

     if (!pattern) {
       return res.status(404).json({ error: "Pattern not found" });
     }

     const mappedPattern = {
       ...pattern,
+      images: admin ? pattern.images : [],
       author: pattern.author?.name || 'Неизвестно',
       // ... остальное без изменений
     };

     res.json(mappedPattern);
```

`getSimilarPatterns` — для не-админа возвращаем пустой список сразу, не
выполняя запрос вообще (дешевле и проще, чем гейтить результат постфактум):

```diff
 export const getSimilarPatterns = async (req: Request, res: Response) => {
   try {
+    if (!isAdminRole(req.userRole)) {
+      return res.json({ data: [] });
+    }
     const { id } = req.params;
     // ... без изменений
```

#### Изменить: `apps/backend/src/controllers/authController.ts`

Единственная правка — добавить роль в тело ответа (НЕ в JWT, см. §3.1 выше про
`resolveRole`):

```diff
     const responseBody = {
       isSubscriber: effectiveIsSubscriber,
       token,
       user: {
         id: userRecord.id,
         telegramId: telegramId.toString(),
         firstName: userRecord.firstName,
+        role: userRecord.role,
       },
     };
```

`userRecord` уже содержит `role` (обычное поле модели `User`, `prisma.user.upsert`
выше по файлу его и так возвращает) — доставать больше неоткуда не нужно.

### 3.2. Frontend

#### Изменить: `apps/frontend-miniapp/src/api/authApi.ts`

```diff
 export interface AuthResponse {
   isSubscriber: boolean;
   token?: string;
   user?: {
     id: string;
     telegramId: string;
     firstName: string;
+    role?: "USER" | "AUTHOR" | "ADMIN";
   };
 }
```

`saveAuthData` ничего менять не нужно — она уже кладёт весь `data.user`
целиком в `localStorage` под ключом `user_data`.

#### Новый файл: `apps/frontend-miniapp/src/hooks/useIsAdmin.ts`

Переиспользует уже существующее событие `auth:ready`, которое `saveAuthData`
в `authApi.ts` и так диспатчит при каждой успешной авторизации — отдельного
контекста/провайдера заводить не нужно.

```ts
import { useEffect, useState } from "react";

const readRole = (): string | undefined => {
  const raw = localStorage.getItem("user_data");
  if (!raw) return undefined;
  try {
    return (JSON.parse(raw) as { role?: string }).role;
  } catch {
    return undefined;
  }
};

export const useIsAdmin = (): boolean => {
  const [isAdmin, setIsAdmin] = useState(() => readRole() === "ADMIN");

  useEffect(() => {
    const onAuthReady = () => setIsAdmin(readRole() === "ADMIN");
    window.addEventListener("auth:ready", onAuthReady);
    return () => window.removeEventListener("auth:ready", onAuthReady);
  }, []);

  return isAdmin;
};
```

#### Изменить: `apps/frontend-miniapp/src/pages/PatternDetails/PatternDetails.tsx`

Единственное место, где фронтовый гейт обязателен (см. §2.5 в v2 — `authorId`
и имя автора уже публичны всегда, бэк для этого пункта не трогаем):

```diff
+import { useIsAdmin } from '../../hooks/useIsAdmin';
 // ...
 export const PatternDetails: React.FC = () => {
+  const isAdmin = useIsAdmin();
   // ...
   const handleAuthorClick = () => {
     if (!pattern?.authorId) return;
     navigate('/', { state: { filterAuthorId: pattern.authorId } });
   };
   // ...
-            {pattern.authorId ? (
+            {pattern.authorId && isAdmin ? (
               <button type="button" className="details-value details-author-link" onClick={handleAuthorClick}>
                 {pattern.author}
               </button>
             ) : (
               <span className="details-value">{pattern.author}</span>
             )}
```

Блок цены, блок "Подробности", блок "Похожие описания" и карусель фото — **не
трогаем** (технически избыточно): раз бэкенд (3.1) для не-админа не пришлёт
`price`/`oldPrice`/`details` и урежет `images` до одного элемента, все
соответствующие `hasPrice`/`hasDiscount`/`similarPatterns.length > 0`-условия
и так окажутся ложными сами по себе, без единой правки в этих компонентах.

`PatternCard.tsx`, `Catalog.tsx`, `patternsApi.ts` — не трогаем по той же
причине; TS-типы там уже `price?`, `oldPrice?`, `details?`, `images?` —
опциональные, фронт уже готов к отсутствию этих полей.

### 3.3. Роль ADMIN конкретному аккаунту

Ничего строить не нужно — уже работает `PATCH /admin/users/:id`
(`usersController.ts`, поле `role`), и он не зависит от фронтенда мини-аппа —
только от админки (Group C, уже задеплоена в шаге 2) и поля `role`, которое
существует в схеме уже сегодня, безотносительно текущей миграции. Назначить
себе `ADMIN` можно сразу после шага 3 (раздел 4) — именно там гейт впервые
становится проверяемым: зайти в админку → Пользователи → найти по
`telegramId` → выставить `ADMIN`.

---

## 4. Порядок действий (обновлён — 6 шагов вместо 7, B+C объединены)

Каждый шаг — отдельный git-коммит, отдельный `git pull` + `pm2 restart` на
проде. Явно фиксирую: прод — одна VPS без staging, каждый деплой — это
короткий рестарт `rapport-api` для реальных пользователей (обычно секунды,
но не нулевой даунтайм). Специального окна для этого не закладываю — сервис и
так уже перезапускается регулярно (229 рестартов у `rapport-api` на момент
проверки), но стоит держать в уме при выборе времени деплоя.

1. **Group A — скрипты парсинга.** Коммитить и деплоить можно сразу. Не
   нажимать "Проверить новинки" в админке для реальных авторов на проде, пока
   не пройден шаг 4.

2. **Group B + Group C одним деплоем** — миграции (`add_pattern_details`,
   `add_pattern_price`) и админ-панель (`apps/admin/*`, `adminController.ts`,
   `authorController.ts`, `syncController.ts`) катятся вместе, в этом порядке
   внутри деплоя: сначала `prisma migrate deploy`, потом рестарт `rapport-api`
   с новым кодом контроллеров.
   *Проверка:* `\d "Pattern"` на проде — новые колонки есть; `SELECT count(*)
   FROM "Pattern" WHERE price IS NOT NULL` = 0; в админке открыть карточку
   паттерна, убедиться что поля цены/деталей редактируются без 500-х; нажать
   "Проверить новинки" для ОДНОГО тестового автора, убедиться что новый
   `AuthorSyncItem` создаётся без ошибки Prisma.
   *Откат:* `git revert` коммита контроллеров — безопасно, т.к. в БД ещё нет
   значений (миграция — чистый `ADD COLUMN`, откатывается вручную `DROP
   COLUMN` при необходимости, потерять нечего).

3. **Ролевой гейт** (раздел 3.1: `patternVisibility.ts`, `resolveRole.ts`,
   правки `patternsController.ts`, `authController.ts`, `routes/patterns.ts`).
   *Проверка:*
   - `curl` без токена на `/patterns/:id` реального паттерна → нет
     `price`/`oldPrice`/`details`, `images` — максимум 1 элемент.
   - Назначить себе ADMIN (раздел 3.3), тот же `curl` с токеном → все поля на
     месте.
   - `GET /patterns/:id/similar` без токена → `{ data: [] }`.
   *Откат:* `git revert` коммита контроллеров/мидлвара — данных этот шаг не
   трогает, откат мгновенный.

4. **Group E — фронтенд мини-аппа** (`PatternDetails.tsx` с гейтом на
   `authorId`, новый `useIsAdmin.ts`, тип в `authApi.ts`).
   *Проверка:* обычным (не-admin) аккаунтом — визуально ничего не изменилось
   (нет цены/подробностей/похожих, имя автора не кликабельно, фото — как
   раньше). Admin-аккаунтом — всё новое на месте, включая кликабельного
   автора.

5. **Бэкофилл** (бэкап `pg_dump` по `Pattern`+`Draft` → dry-run в
   `BEGIN/ROLLBACK` на проде → сверка счётчиков с локальной валидацией → реальный
   `COMMIT`). Требует отдельного явного "да" от пользователя перед прогоном —
   не часть автоматической последовательности.

6. **Пункты 7-9** — вне этого релиза, см. раздел 5.

---

## 5. Будущая работа: пункты 7-9 (без изменений по существу, только уточнение файлов)

Когда дойдёт очередь — `resolveRole` возвращается и в `routes/filters.ts`
(снято из шага 3 текущего релиза по дыре №3, но понадобится здесь):

**П.7 — фильтр и сортировка по цене:**
- `apps/backend/src/utils/patternFilters.ts` — параметр диапазона цены,
  игнорируется если `!isAdminRole(role)`.
- `apps/backend/src/controllers/patternsController.ts` (`getPatterns`) —
  `sortBy=price` под той же проверкой.
- `apps/backend/src/controllers/filtersController.ts` + `routes/filters.ts` —
  подключить `resolveRole`, диапазон цены как фасет только для админа.
- `apps/frontend-miniapp/src/components/FilterModal/FilterModal.tsx` — UI,
  условно по `useIsAdmin()`.

**П.8 — быстрый фильтр "скидка":**
- `apps/backend/src/utils/patternFilters.ts` — параметр `hasDiscount`
  (`oldPrice > price`), та же проверка роли.
- `apps/frontend-miniapp/src/pages/Catalog/Catalog.tsx` — кнопка рядом с
  `isFreeFilterActive`/`isNewFilterActive`, условно по `useIsAdmin()`.

**П.9 — фильтры в избранном:**
- `apps/frontend-miniapp/src/pages/Favorites/Favorites.tsx` +
  `apps/frontend-miniapp/src/api/patternsApi.ts` (`fetchPatternsByIds`) — если
  переиспользуется `FilterModal`, гейт уже есть даром.

Правило то же, что в v2: **если параметр может повлиять на `WHERE`/`ORDER BY` —
бэкенд обязан сам проверять роль независимо от того, показан ли контрол на
фронте**.

---

## 6. Что осталось решить пользователю

1. Подтвердить прогон бэкофилла на проде (шаг 5) — отдельным решением, после
   dry-run.
2. Судьба `implementation_plan.md` (удалён локально), `pattern_images_plan.md`,
   `apps/backend/find_duplicates.ts` (untracked) — коммитить, выкинуть или
   перенести.
3. Устраивает ли TTL кэша роли в 30 секунд (§3.1) — можно сделать короче/длиннее,
   компромисс между нагрузкой на БД и скоростью применения смены роли при тесте.
