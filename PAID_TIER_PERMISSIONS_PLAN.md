# Корректирующий план: разрешения вместо роли — v1

Документ только для планирования. Кода в проекте не меняет.

**Отношение к `PAID_TIER_ROLLOUT_PLAN.md` (v3): не трогаем, не переоткрываем.**
Тот план уже в разработке и будет реализован в согласованном виде — гейтинг
через `role === ADMIN`. Этот документ описывает **следующий, отдельный
корректирующий заход**, который применяется **после** того, как v3 полностью
задеплоен и проверен. Все диффы ниже написаны в предположении, что код из v3
(`resolveRole.ts`, `patternVisibility.ts`, `PATTERN_PREMIUM_OMIT`,
`isAdminRole`, гейт в `patternsController.ts`) уже существует в проде ровно
так, как описано в v3 §3.1.

---

## 0. Задача

Роль (`USER`/`AUTHOR`/`ADMIN`) — грубый инструмент для доступа к платным
фичам: она про то, кто пользователь в системе, а не про то, что он оплатил.
Нужно разрешение, не привязанное к роли, которое можно выдавать/снимать
вручную (сейчас) или автоматически по факту оплаты (в будущем) — любому
пользователю, независимо от того, `USER` он, `AUTHOR` или `ADMIN`.

Разбито на два независимых флага:
- **`PREMIUM_CORE`** — фильтр по плотности и фильтр по толщине пряжи +
  сами значения плотности/толщины на странице описания паттерна
  (`PatternDetails.tsx`). Уточнение: значения НЕ рендерятся в карточках
  каталога/списка (`PatternCard.tsx`, `Catalog.tsx`) — там их не показывают
  вообще, ни при каком раскладе, только на странице одного паттерна. Уже в
  проде, уже бесплатно доступно всем.
- **`PREMIUM_EXTRA`** — всё, что вводит v3 (мультифото, блок "Подробности",
  "Похожие описания", цена в описаниях, ссылка на автора) + будущие пункты
  7–9 из v3 (фильтр/сортировка по цене, быстрый фильтр "скидка", фильтры в
  избранном).

Сейчас: `PREMIUM_EXTRA` выдан только админам (тестирование, платежей ещё
нет). `PREMIUM_CORE` выдан всем существующим и новым пользователям — чтобы
ничего не изменилось для них сегодня. В "день запуска" (раздел 8, вне
текущего плана) `PREMIUM_CORE` массово снимается у всех, кроме админов, и
оба флага начинают выдаваться по факту оплаты.

---

## 1. Модель: используем уже существующую инфраструктуру, не строим новую

В схеме уже есть ровно то, что нужно — `Permission` enum + `UserPermission`
join-таблица, сейчас используемая только для `AUTHOR_CABINET`:

```prisma
enum Permission {
  MINI_APP
  AUTHOR_CABINET
  ADMIN
}

model UserPermission {
  id         String     @id @default(uuid())
  userId     String
  user       User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  permission Permission
  @@unique([userId, permission])
}
```

И уже есть готовый паттерн "роль ИЛИ разрешение" —
`apps/backend/src/middlewares/requirePermission.ts:38`
(`requirePermissionOrAdmin`), которым уже гейтится `AUTHOR_CABINET`. Новые
флаги следуют той же семантике: `ADMIN` по роли всегда имеет полный доступ
без явной выдачи, остальным — выдаётся точечно через `UserPermission`.

Backend-ручки для выдачи/снятия **уже существуют и ничего нового писать не
нужно**:
- `GET /admin/permissions?userId=` (`getPermissions`)
- `POST /admin/permissions` — `{ userId, permission }` (`grantPermission`)
- `DELETE /admin/permissions/:userId/:permission` (`revokePermission`)

Все три — `apps/backend/src/controllers/adminController.ts:1216-1272`,
подключены в `apps/backend/src/routes/admin.ts:195-197` **после**
`router.use(requireAdmin)` (строка 140) — то есть уже защищены так, что
выдавать/снимать разрешения другим пользователям может только сам ADMIN.
Ничего в этом слое менять не требуется.

---

## 2. Миграция схемы

```prisma
enum Permission {
  MINI_APP
  AUTHOR_CABINET
  ADMIN
  PREMIUM_CORE
  PREMIUM_EXTRA
}
```

Чисто аддитивная миграция (`ALTER TYPE "Permission" ADD VALUE ...` × 2) —
не трогает существующие строки, безопасна сама по себе. Имена рабочие,
легко переименовать до релиза (раздел 9, п.1).

---

## 3. Backend — что меняется в уже задеплоенном (по v3) коде

### 3.1. Расширить `resolveRole.ts` до резолвинга обоих флагов

Один и тот же DB-запрос, что уже есть в v3, просто шире `select`:

```diff
 export const resolveRole = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
   if (!req.user) {
-    req.userRole = null;
+    req.premium = { isAdmin: false, core: false, extra: false };
     return next();
   }

   const cached = roleCache.get(req.user.userId);
   if (cached && cached.expiresAt > Date.now()) {
-    req.userRole = cached.role;
+    req.premium = cached.premium;
     return next();
   }

   try {
     const user = await prisma.user.findUnique({
       where: { id: req.user.userId },
-      select: { role: true },
+      select: {
+        role: true,
+        permissions: {
+          where: { permission: { in: [Permission.PREMIUM_CORE, Permission.PREMIUM_EXTRA] } },
+          select: { permission: true },
+        },
+      },
     });
-    req.userRole = user?.role ?? null;
+    const isAdmin = user?.role === UserRole.ADMIN;
+    const perms = new Set(user?.permissions.map((p) => p.permission));
+    req.premium = {
+      isAdmin,
+      core: isAdmin || perms.has(Permission.PREMIUM_CORE),
+      extra: isAdmin || perms.has(Permission.PREMIUM_EXTRA),
+    };
   } catch {
-    req.userRole = null;
+    req.premium = { isAdmin: false, core: false, extra: false };
   }

-  roleCache.set(req.user.userId, { role: req.userRole, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
+  roleCache.set(req.user.userId, { premium: req.premium, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
   next();
 };
```

Кэш (уже есть в v3, TTL 30 сек, per-process `Map`) не меняется по сути —
кэшируемое значение шире (весь объект `premium`), логика TTL/инвалидации та
же.

Переименование файла/типа `req.userRole` → `req.premium` — по вкусу на
этапе реализации; можно оставить имя файла `resolveRole.ts`, поменять только
контракт.

### 3.2. `patternVisibility.ts` — `isAdminRole` заменяется на `hasExtra`

```diff
-export const isAdminRole = (role: UserRole | null | undefined): boolean =>
-  role === UserRole.ADMIN;
+export const hasExtra = (req: Request): boolean => !!req.premium?.extra;
+export const hasCore = (req: Request): boolean => !!req.premium?.core;
```

Везде, где v3 писал `isAdminRole(req.userRole)` для гейта
`price`/`oldPrice`/`details`/`images`/`similar` (`getPatterns`,
`getPatternsByIds`, `getPatternById`, `getSimilarPatterns` в
`patternsController.ts`) — заменить на `hasExtra(req)`. Для админов
поведение не меняется (было `true`, осталось `true` — через
`req.premium.isAdmin` внутри `resolveRole`); для остальных пользователей
меняется только тогда, когда им явно выдан `PREMIUM_EXTRA`.

### 3.3. Новый гейт для `PREMIUM_CORE` — density/толщина пряжи

Это гейтится **впервые** — v3 сознательно не трогал эту фичу, она была уже в
проде и бесплатна для всех. Три места:

- **`patternsController.ts`** — `densityStitches`, `densityRows` (обычные
  scalar-поля `Pattern`, сейчас нигде не омитятся) и `yarnRanges`
  (relation, инклюдится в `getPatternById`) — под `hasCore(req)`, тем же
  способом, что `PATTERN_PREMIUM_OMIT` для `PREMIUM_EXTRA`-полей.
- **`patternFilters.ts`** (`buildPatternWhere`) — параметры `yarnRanges` и
  `density` в query должны игнорироваться, если `!hasCore(req)` (то же
  правило, которое v3 §5 уже закладывал на будущее для `price`-фильтра —
  здесь оно нужно раньше).
- **`filtersController.ts` + `routes/filters.ts`** — сюда наконец
  подключается `resolveRole`/`resolvePremiumAccess` (v3 §3.1 сознательно
  откладывал это до будущего пункта 7 — теперь понадобилось раньше, из-за
  density/yarnRanges facets), а `getFilters` не должен отдавать
  `yarnRanges`/`density` в ответе, если `!hasCore(req)`.

**Где именно перехватывать query-параметры.** `buildPatternWhere` — чистая
функция без доступа к `req`/роли, и вызывается 6 раз: один раз в
`getPatterns`, пять раз внутри `getFilters` (по разу на фасету). Тащить роль
третьим параметром через все 6 вызовов — хрупко, легко забыть один. Вместо
этого — один раз, до первого вызова `buildPatternWhere`, вырезать
`yarnRanges`/`density` из `req.query` в новом хелпере в `patternFilters.ts`:

```ts
export const stripPremiumFacetParams = (
  query: Record<string, unknown>,
  hasCore: boolean
): Record<string, unknown> => {
  if (hasCore) return query;
  const { yarnRanges, density, ...rest } = query;
  return rest;
};
```

И передавать везде не `req.query`, а результат этого хелпера:

```diff
 export const getPatterns = async (req: Request, res: Response) => {
   try {
     const { search, isFree, isNew, limit, offset } = req.query;
-    const where: any = buildPatternWhere(req.query);
+    const query = stripPremiumFacetParams(req.query, hasCore(req));
+    const where: any = buildPatternWhere(query);
```

```diff
 export const getFilters = async (req: Request, res: Response) => {
   try {
+    const core = hasCore(req);
+    const query = stripPremiumFacetParams(req.query, core);
     const [categories, tags, instruments, authors, yarnRangesRaw, densityRaw] = await Promise.all([
-      prisma.productType.findMany({ where: { patterns: { some: buildPatternWhere(req.query, "categories") } }, ... }),
-      prisma.tag.findMany({ where: { patterns: { some: buildPatternWhere(req.query, "tags") } }, ... }),
-      prisma.instrument.findMany({ where: { patterns: { some: buildPatternWhere(req.query, "instruments") } }, ... }),
-      prisma.author.findMany({ where: { patterns: { some: buildPatternWhere(req.query, "authors") } }, ... }),
-      prisma.yarnRange.findMany({ where: { patterns: { some: buildPatternWhere(req.query, "yarnRanges") } }, ... }),
-      prisma.pattern.findMany({ where: { ...buildPatternWhere(req.query, "density"), ... }, ... }),
+      prisma.productType.findMany({ where: { patterns: { some: buildPatternWhere(query, "categories") } }, ... }),
+      prisma.tag.findMany({ where: { patterns: { some: buildPatternWhere(query, "tags") } }, ... }),
+      prisma.instrument.findMany({ where: { patterns: { some: buildPatternWhere(query, "instruments") } }, ... }),
+      prisma.author.findMany({ where: { patterns: { some: buildPatternWhere(query, "authors") } }, ... }),
+      // Не только фильтруем query — саму facet-выборку для не-core вообще не
+      // запускаем (та же оптимизация, что getSimilarPatterns делает для
+      // не-админов в v3 — нет смысла бить по БД ради данных, которые всё
+      // равно выбросим).
+      core
+        ? prisma.yarnRange.findMany({ where: { patterns: { some: buildPatternWhere(query, "yarnRanges") } }, ... })
+        : Promise.resolve([]),
+      core
+        ? prisma.pattern.findMany({ where: { ...buildPatternWhere(query, "density"), densityStitches: { not: null }, densityRows: { not: null } }, ... })
+        : Promise.resolve([]),
     ]);
```

Ровно 2 точки перехвата (вход `getPatterns`, вход `getFilters`) вместо 6 —
`buildPatternWhere` как была чистой функцией без знания о роли, так и
остаётся, роль решается один раз до неё.

**Критично для "ничего не должно поменяться сейчас":** это новое
ограничение полностью нейтрализуется бэкофиллом (раздел 4) — если на момент
деплоя `PREMIUM_CORE` стоит у всех существующих пользователей, для них
ничего не меняется ни на бит. Гейт входит в силу только для новых
пользователей, зарегистрировавшихся ПОСЛЕ "дня запуска" (раздел 8).

### 3.4. Фронтенд гейтится не только по `isAdmin` — нужны сами флаги, не только роль

Найдена более широкая версия проблемы, которую вскрыл разбор `FilterModal.tsx`
(секции "Толщина пряжи"/"Плотность" рендерят кликабельный заголовок всегда,
`renderSection`, независимо от того, пуст ли список опций — `options.length`
нигде не проверяется перед рендером самой секции). Гейтить эти два вызова
`renderSection` нужно снаружи, условием — но условием должно быть **наличие
`PREMIUM_CORE`**, а не `isAdmin`: иначе обычный пользователь, которому флаг
выдали вручную (весь смысл этого плана — что так можно), всё равно не увидит
секции, потому что не админ.

Ровно та же ошибка уже сидит в коде, который сам этот план оставлял
нетронутым — `useIsAdmin()` в `PatternDetails.tsx` (гейт кликабельности
имени автора, сделан в v3) буквально проверяет `role === "ADMIN"`, а должен
бы проверять `PREMIUM_EXTRA`. До сих пор это было незаметно, потому что
`PREMIUM_EXTRA` и так выдан только админам — но это тот же класс поломки,
что и в `FilterModal`, просто пока скрытый тем же фактом ("сейчас выдано
только админам"), что скрывает поломку в `FilterModal` до бэкофилла с
раздела 4.

Корень проблемы — `authController.ts` до сих пор (даже после диффа v3)
отдаёт фронту только `role`, ни `PREMIUM_CORE`, ни `PREMIUM_EXTRA` фронту
просто неоткуда узнать. Фикс — на обоих концах:

**Backend** — добавить список разрешений в ответ `POST /auth/telegram`,
той же формы, что уже отдаёт `AdminUserDetail.permissions` в админке:

```diff
     const userRecord = await prisma.user.upsert({
       where: { telegramId: BigInt(telegramId) },
       update: { firstName, lastName, username, languageCode },
       create: { telegramId: BigInt(telegramId), firstName, lastName, username, languageCode },
+      include: { permissions: { select: { permission: true } } },
     });
```

```diff
+    // userRecord.permissions отражает состояние ДО авто-гранта из §5 (тот
+    // выполняется позже, отдельным запросом) — для только что созданного
+    // пользователя дописываем PREMIUM_CORE вручную, а не перезапрашиваем.
+    const permissions = userRecord.permissions.map((p) => p.permission as string);
+    if (!existingUser) {
+      permissions.push("PREMIUM_CORE");
+    }
+
     const responseBody = {
       isSubscriber: effectiveIsSubscriber,
       token,
       user: {
         id: userRecord.id,
         telegramId: telegramId.toString(),
         firstName: userRecord.firstName,
         role: userRecord.role,
+        permissions,
       },
     };
```

**Frontend** — `authApi.ts`, расширить тип:

```diff
   user?: {
     id: string;
     telegramId: string;
     firstName: string;
     role?: "USER" | "AUTHOR" | "ADMIN";
+    permissions?: string[];
   };
```

Переименовать/расширить `useIsAdmin.ts` → `usePremiumAccess.ts`, чтобы
компоненты проверяли именно нужный флаг, а не грубо "админ или нет":

```ts
interface PremiumAccess { isAdmin: boolean; core: boolean; extra: boolean; }

const readAccess = (): PremiumAccess => {
  const raw = localStorage.getItem("user_data");
  if (!raw) return { isAdmin: false, core: false, extra: false };
  try {
    const data = JSON.parse(raw) as { role?: string; permissions?: string[] };
    const isAdmin = data.role === "ADMIN";
    const permissions = data.permissions ?? [];
    return {
      isAdmin,
      core: isAdmin || permissions.includes("PREMIUM_CORE"),
      extra: isAdmin || permissions.includes("PREMIUM_EXTRA"),
    };
  } catch {
    return { isAdmin: false, core: false, extra: false };
  }
};

export const usePremiumAccess = (): PremiumAccess => {
  const [access, setAccess] = useState(readAccess);
  useEffect(() => {
    const onAuthReady = () => setAccess(readAccess());
    window.addEventListener("auth:ready", onAuthReady);
    return () => window.removeEventListener("auth:ready", onAuthReady);
  }, []);
  return access;
};
```

Оба места использования — исправить на правильный флаг, не на `isAdmin`:

```diff
 // PatternDetails.tsx
-import { useIsAdmin } from '../../hooks/useIsAdmin';
+import { usePremiumAccess } from '../../hooks/usePremiumAccess';
 ...
-  const isAdmin = useIsAdmin();
+  const { extra } = usePremiumAccess();
 ...
-            {pattern.authorId && isAdmin ? (
+            {pattern.authorId && extra ? (
```

```diff
 // FilterModal.tsx
+import { usePremiumAccess } from '../../hooks/usePremiumAccess';
 ...
 export const FilterModal: React.FC<FilterModalProps> = (...) => {
+  const { core } = usePremiumAccess();
   ...
-          {renderSection("Толщина пряжи (м/100г)", "yarnRanges")}
+          {core && renderSection("Толщина пряжи (м/100г)", "yarnRanges")}
   ...
-          {renderSection("Плотность", "density")}
+          {core && renderSection("Плотность", "density")}
```

Счётчик активных фильтров (`advancedFilters.yarnRanges.length +
advancedFilters.density.length` в `Catalog.tsx`) отдельного фикса не требует
для НОВОГО выбора — раз секции не отрендерены, выбрать в них ничего
физически нельзя, новые значения туда не попадут. Но есть узкий краевой
случай с уже сохранённым состоянием: `Catalog.tsx` восстанавливает
`advancedFilters` из `sessionStorage` (`catalog_advanced_filters`) при
каждом заходе на страницу. Если пользователь выбрал толщину/плотность, пока
`PREMIUM_CORE` у него ещё был, а затем флаг сняли — значения в
`sessionStorage` переживут это и молча восстановятся при следующем открытии
каталога, хотя показать их уже негде — счётчик активных фильтров может
показать "2" при пустой на вид модалке. Это чисто косметическая
несостыковка счётчика, не утечка доступа — `stripPremiumFacetParams` (§3.3)
всё равно игнорирует эти параметры в запросе к бэкенду, значит на данные это
не влияет. Достаточно краевой случай (нужна конкретная последовательность:
иметь `core` → выбрать фильтр → флаг отозвать → зайти в каталог заново, не
почистив сессию), чтобы не чинить отдельным кодом сейчас — но стоит иметь в
виду при реальном тестировании "дня запуска", чтобы не читать это как
необъяснимый баг.

Пока `PREMIUM_CORE`/`PREMIUM_EXTRA` выданы (бэкофиллом или только админам)
всем, у кого раньше был соответствующий доступ, эффект от этого фикса не
виден — расхождение всплывёт только в "день запуска" (для `core`) или в
момент, когда `PREMIUM_EXTRA` впервые выдадут не-админу (для `extra`). Не
блокирует деплой этого плана, но должно войти в тот же деплой, что и §3.1-3.3
— иначе поймать по-настоящему это можно только руками потом, а не через
чек-лист §9.

---

## 4. Бэкофилл — сохранить текущее поведение для существующих пользователей

Одноразово при деплое этого плана:

```sql
INSERT INTO "UserPermission" (id, "userId", permission)
SELECT gen_random_uuid(), id, 'PREMIUM_CORE'
FROM "User"
WHERE role != 'ADMIN'
ON CONFLICT ("userId", permission) DO NOTHING;
```

(Админам не нужно — `role === ADMIN` уже даёт полный доступ через
`req.premium.isAdmin`, дублировать явной записью бессмысленно.)

`PREMIUM_EXTRA` **не бэкофиллится никому** — выдаётся только явно через
админку, и сейчас — только админам, что и требуется ("это разрешение будет
включено только у админов, для тестирования функциональности").

Как и с бэкофиллом в v3 — прогнать сначала в `BEGIN/ROLLBACK`, свериться,
что число вставленных строк равно числу не-админов на момент прогона, потом
`COMMIT`.

---

## 5. Новые пользователи — тоже получают `PREMIUM_CORE` по умолчанию (временно)

**Важно: не вешать на сам `upsert`.** `prisma.user.upsert(...)` в
`authController.ts:104` выполняется на **каждый** вызов `POST
/auth/telegram`, то есть на каждый логин, не только на первую регистрацию —
`upsert` в принципе не сообщает, была ли это ветка `create` или `update`.
Если повесить авто-выдачу `PREMIUM_CORE` прямо на него безусловно (как было
в предыдущей редакции этого раздела) — то как только `PREMIUM_CORE` снимут у
конкретного пользователя вручную через админку, флаг молча вернётся обратно
при следующем же открытии мини-аппа этим пользователем. Это не гипотетика, а
прямая поломка собственного чек-листа §9 (шаг 3: "снять флаг → проверить,
что density/thickness пропали" — сама проверка есть повторный логин, который
тут же откатывает то, что проверяется). Та же дыра ломает порядок в §8: если
массовый `DELETE` выполнить раньше, чем убрать этот код, любой, кто успеет
залогиниться в промежутке, получит `PREMIUM_CORE` обратно немедленно.

Исправление — явно отличить создание от обновления через `findUnique` до
`upsert`, и выдавать флаг только в ветке "пользователя не было":

```diff
+    const existingUser = await prisma.user.findUnique({
+      where: { telegramId: BigInt(telegramId) },
+      select: { id: true },
+    });
+
     const userRecord = await prisma.user.upsert({
       where: { telegramId: BigInt(telegramId) },
       update: { firstName, lastName, username, languageCode },
       create: { telegramId: BigInt(telegramId), firstName, lastName, username, languageCode },
     });

+    // TEMPORARY: пока не запущен платный функционал, PREMIUM_CORE выдаётся
+    // всем НОВЫМ пользователям автоматически, чтобы density/yarn-thickness
+    // фильтры оставались бесплатными как сегодня. Работает строго один раз,
+    // на создании — иначе ручное снятие флага через админку откатывалось бы
+    // на следующем же логине этого пользователя. Убрать этот блок целиком —
+    // часть runbook'а "День запуска" (см. PAID_TIER_PERMISSIONS_PLAN.md §8),
+    // и убрать его нужно ДО массового DELETE, не после — см. §8.
+    if (!existingUser) {
+      await prisma.userPermission.upsert({
+        where: { userId_permission: { userId: userRecord.id, permission: Permission.PREMIUM_CORE } },
+        create: { userId: userRecord.id, permission: Permission.PREMIUM_CORE },
+        update: {},
+      });
+    }
```

Новый `role !== ADMIN`-проверки больше нет — она была избыточна: только что
созданный пользователь не может иметь роль `ADMIN` (схема даёт `@default(USER)`
всем новым записям), так что условие всегда было true для create-ветки и
ничего не фильтровало.

Цена исправления — один дополнительный indexed `SELECT` по уникальному
`telegramId` на каждый логин (тот же порядок стоимости, что уже принят для
`resolveRole` в v3 — разовый дешёвый lookup, не бутылочное горлышко).

Это единственное место, которое нужно будет вручную убрать в "день запуска"
— весь остальной гейтинг-код к этому моменту уже давно в проде и просто
ждёт данных.

---

## 6. Admin UI — переключатель в карточке пользователя

`apps/admin/src/pages/Users/Users.tsx`, компонент `PermissionsSection` (уже
существует, сейчас редактирует только роль + привязку автора) — добавить 2
независимых чекбокса, не завязанных на роль:

```diff
   const [role, setRole] = useState<UserRole>(user.role);
+  const [premiumCore, setPremiumCore] = useState(user.permissions.includes("PREMIUM_CORE"));
+  const [premiumExtra, setPremiumExtra] = useState(user.permissions.includes("PREMIUM_EXTRA"));
   ...
   const handleSave = async () => {
     ...
     setIsSaving(true);
     try {
       await updateUser(user.id, { role, authorId: role === "AUTHOR" ? authorId : null });
+      await syncPermission(user.id, "PREMIUM_CORE", premiumCore, user.permissions.includes("PREMIUM_CORE"));
+      await syncPermission(user.id, "PREMIUM_EXTRA", premiumExtra, user.permissions.includes("PREMIUM_EXTRA"));
       toast.success("Разрешения обновлены");
       ...
```

```diff
   const isDirty = role !== user.role || authorId !== user.authorId;
+    || premiumCore !== user.permissions.includes("PREMIUM_CORE")
+    || premiumExtra !== user.permissions.includes("PREMIUM_EXTRA");
```

Разметка — под селектом роли:

```tsx
<div className={styles.permRow}>
  <label><input type="checkbox" checked={premiumCore} onChange={(e) => setPremiumCore(e.target.checked)} /> Платно: плотность/толщина пряжи</label>
</div>
<div className={styles.permRow}>
  <label><input type="checkbox" checked={premiumExtra} onChange={(e) => setPremiumExtra(e.target.checked)} /> Платно: полный доступ</label>
</div>
```

Новая тонкая обёртка `apps/admin/src/api/users.ts` над уже существующими
бэкенд-эндпоинтами (`grantPermission`/`revokePermission`) — на бэкенде
ничего нового писать не нужно:

```ts
export const syncPermission = async (userId: string, permission: string, wanted: boolean, had: boolean): Promise<void> => {
  if (wanted === had) return;
  if (wanted) {
    await fetchWithAuth(`${API_URL}/admin/permissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, permission }),
    });
  } else {
    await fetchWithAuth(`${API_URL}/admin/permissions/${userId}/${permission}`, { method: "DELETE" });
  }
};
```

`AdminUserDetail.permissions: string[]` (`apps/admin/src/api/users.ts:26`)
уже приходит с бэкенда (`getUserById` уже селектит и мапит `permissions`,
`apps/backend/src/controllers/usersController.ts:93,112`) — фронту ничего
дополнительно запрашивать не нужно.

---

## 7. Точка интеграции с оплатой — не реализуется сейчас, только маркер

Когда появится оплата — обработчик успешного платежа должен вызвать ровно ту
же логику выдачи, что и админ-чекбоксы: `grantPermission` для `PREMIUM_CORE`
И `PREMIUM_EXTRA` разом (оба флага, как описано в задаче: "будем включать
оба при оплате"). Сейчас код для этого не пишем — самой оплаты в задаче ещё
нет, это открытая точка интеграции на будущее.

---

## 8. "День запуска платного функционала" — раннер-бук на будущее (вне этого плана)

Не выполняется сейчас, фиксирую заранее, чтобы будущий переход был чисто
операционным действием, а не написанием нового кода:

**Порядок важен и обратный интуитивному** — код убирается ПЕРВЫМ, массовый
`DELETE` идёт ВТОРЫМ. Если снести auto-grant после `DELETE`, любой, кто
успеет залогиниться в промежутке между двумя действиями, получит
`PREMIUM_CORE` обратно немедленно (см. §5) — сброс окажется неполным.

1. Убрать временный auto-grant из `authController.ts` — **оба места, не
   только одно**: сам грант `prisma.userPermission.upsert(...)` (раздел 5) И
   строку `permissions.push("PREMIUM_CORE")` в сборке ответа `POST
   /auth/telegram` (раздел 3.4) — вторая жёстко завязана на первую
   (комментирует то, что грант произойдёт чуть ниже) и без неё останется
   висеть сама по себе. Если убрать только грант, но не эту строку — ответ
   авторизации продолжит врать новому пользователю, что `PREMIUM_CORE` у
   него есть, хотя в БД его уже никто не выдаёт (несостыковка вскроется
   только на следующий логин, когда `resolveRole` пересчитает разрешения
   заново из БД и даст другой ответ, чем то, что фронт уже показал).
   Задеплоить это первым, до массового `DELETE`. С этого момента новые
   пользователи больше не получают `PREMIUM_CORE` бесплатно, а у
   существующих пока ничего не меняется (флаг у них ещё стоит).
2. Массово снять `PREMIUM_CORE` у всех, кроме `ADMIN` — только после того,
   как код из шага 1 уже в проде:
   ```sql
   DELETE FROM "UserPermission" WHERE permission = 'PREMIUM_CORE'
     AND "userId" IN (SELECT id FROM "User" WHERE role != 'ADMIN');
   ```
3. Включить реальную выдачу обоих флагов по факту оплаты (раздел 7).

Отдельное решение пользователя в будущем, требует dry-run/бэкап тем же
способом, что бэкофилл в v3 — массовый `DELETE` по живым пользователям.

---

## 9. Порядок деплоя этого плана (после того как v3 полностью выкачен и проверен)

1. **Миграция + бэкофилл** (разделы 2, 4) — сначала `BEGIN/ROLLBACK`,
   сверка счётчика вставленных строк, потом `COMMIT`.
2. **Backend** — расширение `resolveRole`/`patternVisibility.ts`, замена
   `isAdminRole` → `hasExtra`, новый гейт `hasCore` в `patternsController.ts`
   / `filtersController.ts` / `patternFilters.ts` / `routes/filters.ts`,
   auto-grant в `authController.ts` (раздел 5), **и в том же деплое** —
   `permissions` в ответе `POST /auth/telegram` (раздел 3.4), без этого
   пункт 3 ниже не имеет смысла проверять.
   *Проверка:* обычный пользователь (без явных флагов, но с backfilled
   `PREMIUM_CORE`) — density/thickness фильтры и значения в карточках
   работают как сегодня; price/details/similar/мультифото — по-прежнему
   недоступны (как и после v3). Отдельно — `POST /auth/telegram` возвращает
   `user.permissions` как массив (для backfilled-пользователя — как минимум
   `["PREMIUM_CORE"]`).
3. **Mini-app фронтенд** — `usePremiumAccess` вместо `useIsAdmin` (раздел
   3.4): `PatternDetails.tsx` (гейт автора на `extra`), `FilterModal.tsx`
   (гейт секций "Толщина пряжи"/"Плотность" на `core`).
   *Проверка:* выдать `PREMIUM_EXTRA` тестовому НЕ-админу — кликабельность
   автора появляется именно у него (не только у ADMIN). Снять `PREMIUM_CORE`
   у тестового пользователя — секции "Толщина пряжи"/"Плотность" в фильтрах
   пропадают из модалки целиком (не просто пустые), у остальных — нет.
4. **Admin UI** — чекбоксы в карточке пользователя (раздел 6).
   *Проверка:* снять/выдать оба флага через чекбоксы, убедиться что шаг 3
   отражает изменение (после TTL кэша).
   Учесть кэш роли/разрешений из v3 (TTL 30 сек, тот же `resolveRole`) —
   если проверять эффект сразу после сохранения чекбокса, до 30 секунд ещё
   может быть виден старый результат; это не баг, подождать TTL перед тем,
   как считать проверку проваленной.

---

## 10. Что осталось решить пользователю

1. Финальные имена флагов (`PREMIUM_CORE`/`PREMIUM_EXTRA` — рабочие,
   переименовать проще всего сейчас, до миграции).
2. Точные подписи чекбоксов в админке (раздел 6 — черновой текст).
3. Явно подтвердить: `ADMIN` по роли продолжает означать полный доступ в
   обход обоих флагов (как для `AUTHOR_CABINET` сегодня) — если для теста
   понадобится аккаунт "платный, но не админ", тестировать нужно на обычном
   `USER`/`AUTHOR` с вручную выданным флагом, не на `ADMIN`.
