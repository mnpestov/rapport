# Реализация Refresh Tokens для Админки (v5 - Final Architecture)

План был глубоко переработан на основе аналитики безопасности (CORS, CSRF), производительности (утечки памяти Blob), работы в нескольких вкладках и минимизации зависимостей (GC без cron). Прошёл `/plan-eng-review` и `/plan-design-review`.

## Утверждение пользователя (User Review Required)

> [!WARNING]
> Этот план описывает продакшен-ready решение. 
> Пожалуйста, проверьте секцию с компромиссами по аудио (пункт 3.4). Домен админки и CORS (пункт 2.1) — подтверждены. UX-состояния (раздел 4) — подтверждены. Если вы согласны со всеми пунктами — мы можем переходить к реализации кода.

## Домены (подтверждено)

- Admin: `https://admin.rapport.su`
- Backend API: `https://rapport.su` (pm2 `rapport-api`, см. `package.json` deploy-скрипт)
- Оба — поддомены одного root-домена `rapport.su`, то есть **одного site** в терминах `SameSite`. `sameSite: 'lax'` будет корректно долетать между ними без `SameSite=None` и без явного `domain`-атрибута на cookie.
- `ADMIN_CORS_ORIGINS` должен включать `https://admin.rapport.su` + локальный dev-порт Vite (например `http://localhost:5173`).

---

## 1. Архитектура безопасности и Хранение (Security & Storage)

- **Раздельные секреты**: Строго разделяем `JWT_ACCESS_SECRET` и `JWT_REFRESH_SECRET` в `.env`.
- **Хранение Access-токена (24 часа)**: Хранится **строго в оперативной памяти** (JS memory). `localStorage` не используется для токенов.
- **Хранение Refresh-токена (30 дней)**: Устанавливается бэкендом через заголовок `Set-Cookie` с флагами: `httpOnly: true`, `secure: true`, `sameSite: 'lax'`, `path: '/auth'`. (Path `/auth` гарантирует, что токен не улетает с каждым запросом к API, а только при вызовах refresh/logout).
- **Обновление — реактивное, не по таймеру**: рефреш срабатывает только на 401 от реального API-запроса (3.2) или на bootstrap при F5 (3.1). Проактивного фонового таймера нет осознанно — при 24-часовом access-токене это будет максимум 1 rotation в сутки на активного админа, отдельный таймер добавил бы код и лишние rotation-записи в БД без ощутимой пользы. Пока вы заходите в админку в пределах 30 дней (жизнь refresh-токена), сессия не прерывается.

### 1.1 Защита от CSRF
Для защиты эндпоинтов `/auth/refresh` и `/auth/logout` мы не только полагаемся на `sameSite: 'lax'`, но и добавляем проверку кастомного заголовка, например: `X-Requested-With: XMLHttpRequest` или `X-App-Client: AdminPanel`. Простая HTML-форма атакующего не сможет выставить такой заголовок, что существенно снижает риск CSRF-атак на ротацию. Эта защита завязана на корректности CORS-allowlist (2.1) — кастомный заголовок триггерит preflight `OPTIONS`, который отсекается тем же allowlist; при ослаблении CORS в будущем эта защита тоже ослабнет, так что оба пункта надо держать в связке.

---

## 2. Изменения Backend (`apps/backend`)

### 2.1 Настройка CORS (`src/index.ts`)
Браузер не примет и не отправит `httpOnly` cookie при кросс-origin запросах без явной настройки CORS:
- Заменяем `app.use(cors())` на настройку с массивом разрешенных origin (читаем из `process.env.ADMIN_CORS_ORIGINS`, см. секцию "Домены" выше).
- Явно выставляем `credentials: true`.
- В `allowedHeaders` явно добавляем кастомный CSRF-заголовок из 1.1, иначе preflight `OPTIONS` для `/auth/refresh`/`/auth/logout` будет падать.
- Mini App (`apps/frontend-miniapp`) работает на том же origin, что и backend (проксирование через nginx), поэтому сужение CORS его не затрагивает — браузер не применяет CORS-проверки к same-origin запросам.

### 2.2 Модель `RefreshToken` (Prisma)
- Добавляем модель в `schema.prisma`: поля `token` (hash), `userId`, `expiresAt`, `revoked`, **`revokedAt DateTime?`** (нужно для проверки grace-периода в 2.3 — без него нельзя определить, отозван ли токен "менее 15 секунд назад").
- **Probabilistic Garbage Collection (Сборка мусора без cron)**: Отказываемся от зависимости `node-cron`. Вместо этого в эндпоинте `verifyCode` или `refresh` добавляем вероятностную очистку:
  ```typescript
  if (Math.random() < 0.05) { // 5% шанс на вызов очистки
    prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(console.error);
  }
  ```

### 2.3 Ротация и Grace-период
При вызове `POST /auth/refresh`:
1. Бэкенд забирает токен из cookies (req.cookies).
2. Проверяет в БД.
3. Помечает старый токен как отозванный, но **даёт окно дожития (Grace Period = 15 сек)**. Если за это время придет параллельный запрос с тем же старым токеном (например, сетевой ретрай клиента), он вернет новую пару, а не 401.

---

## 3. Изменения Frontend Admin (`apps/admin`)

### 3.1 Bootstrap (Восстановление сессии при F5)
Так как Access-токен хранится только в памяти, перезагрузка страницы (F5) стирает его.
- **Решение**: Добавляем хук `useAuthBootstrap` (или инициализацию в контексте), который при маунте приложения (до рендера роутера) делает тихий `POST /auth/refresh` с `credentials: 'include'`.
- Если кука жива, бэкенд возвращает новый Access-токен, приложение записывает его в память и пускает админа. Если куки нет/протухла — редирект на логин.

### 3.2 Fetch Interceptor и Single-Flight
- Обертка `fetchWithAuth`:
  - К вызовам `/auth/*` явно добавляет `credentials: 'include'`.
  - К остальным API вызовам добавляет `Authorization: Bearer <in_memory_token>`.
- **Мьютекс (Гонка)**: При 401 ошибке от API только первый запрос триггерит рефреш. Остальные параллельные запросы становятся в Promise queue и ждут завершения ротации, после чего повторяются с новым Access-токеном.

### 3.3 Синхронизация вкладок (Multi-tab)
- Используем `BroadcastChannel('auth_channel')`.
- При успешном рефреше вкладка шлет сообщение `TOKEN_REFRESHED` с новым Access-токеном. Остальные вкладки забирают его в память и снимают блокировки со своих запросов.
- При нажатии на кнопку "Выйти" шлется сообщение `LOGOUT`. Все открытые вкладки показывают тост (см. 4.2) и редиректятся на логин — **не мгновенно**, см. 4.2 про UX смягчение форс-логаута.

### 3.4 Загрузка медиа и предотвращение утечек памяти
Отказываемся от `?token=` в атрибутах `src` из-за протухания ссылок.
- Создаем компонент `<MediaLoader url="..." />`. Он вызывает `fetchWithAuth`, перехватывает 401 как обычный запрос, и конвертирует ответ: `const objectUrl = URL.createObjectURL(await res.blob())`.
- **Пока blob грузится** — см. 4.1 (skeleton, не спиннер).
- **Предотвращение утечек**: В компоненте добавляем обязательный cleanup `useEffect`:
  ```typescript
  return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }
  ```
- **[КОМПРОМИСС ПО АУДИО]**: Подход с Blob загружает файл в память целиком, что ломает HTTP Range-запросы (перемотка стримом без полной загрузки). Для коротких аудио (войсы) это не проблема, но для длинных — UX регресс. Если в проекте нет гигантских аудио, принимаем этот компромисс ради безопасности и стабильности сессии.

### 3.5 Завершение миграции: удаление `?token=` из query-параметров
После перевода всей загрузки медиа на `MediaLoader`/Blob (3.4), ветка `queryToken` в [`middlewares/auth.ts`](../apps/backend/src/middlewares/auth.ts) (поддержка токена в query-параметре для `<img>/<audio>`) становится мёртвым кодом. Удаляем её как часть этого PR — токен в URL иначе продолжает попадать в access-логи сервера и `Referer`-заголовки, что не соответствует заявленному "production-ready" статусу.

---

## 4. UX-состояния (по итогам `/plan-design-review`)

План выше полностью описывает backend-механику, но не описывал, что видит админ в трёх новых для пользователя моментах. Ниже — конкретная спецификация, привязанная к существующим токенам проекта (шрифт `Mulish`, акцент `#83942C`, ошибка/деструктив `#ef4444`, фон `#F8F9FA`, приглушённый текст `#6B7280` — см. `Login.module.css`/`Sidebar.module.css`).

### 4.1 Bootstrap (F5) и загрузка медиа
- **Bootstrap**: центрированный спиннер `#83942C` на фоне `#F8F9FA` (как у страницы логина), но с задержкой показа **150мс** — если `/auth/refresh` отвечает быстрее, спиннер не показываем вообще (избегаем "мигания").
- **MediaLoader**: **skeleton** с зафиксированными размерами (не спиннер в пустом боксе) — устраняет layout shift в галерее паттернов. Skeleton должен занимать те же размеры, что и текущий CSS-контейнер под `<img>` (реализация должна фиксировать box заранее через CSS, а не полагаться на естественные размеры изображения).
- **a11y**: контейнер bootstrap-загрузки — `aria-live="polite"` с текстом "Восстановление сессии...", чтобы скринридер не оставлял пользователя на немой пустой странице.

### 4.2 Форс-логаут (истечение сессии / logout в другой вкладке)
Раньше план описывал мгновенный редирект без объяснения — худший вариант, если админ в этот момент печатает текст в форме (несохранённые данные теряются без предупреждения).
- Показываем тост (`react-hot-toast`, уже используется в `Login.tsx`) на **~2 секунды** перед редиректом:
  - Истечение refresh-токена: *"Сессия истекла. Войдите снова."*
  - Logout из другой вкладки: *"Вы вышли в другой вкладке."*
- Тост — `role="alert"`, чтобы объявлялся скринридером немедленно.
- Явный logout (кнопка "Выйти" в текущей вкладке) — редирект без тоста, это ожидаемое пользователем действие.

### 4.3 Таблица состояний

| Состояние | LOADING | ERROR | SUCCESS |
|---|---|---|---|
| Bootstrap (F5) | Спиннер после 150мс | Редирект на `/login` без тоста (первая загрузка — ещё нет сессии, объяснять нечего) | Роутер рендерится |
| MediaLoader | Skeleton с фикс. размером | Иконка "не удалось загрузить" на месте skeleton | Blob подставлен в `src` |
| Форс-логаут (истечение/чужая вкладка) | — | — (это и есть терминальное состояние) | Тост 2сек → редирект на `/login` |
| Manual logout | — | Тост "Не удалось выйти, попробуйте снова" при сетевой ошибке, сессия остаётся активной | Мгновенный редирект, без тоста |

---

---

## Чеклист реализации

### ⓪ Предварительно — зафиксировать кабинет автора

- [ ] `git add` все файлы кабинета автора (schema, migration, controllers, routes, middlewares)
- [ ] `git commit` — отдельный коммит "feat: author cabinet backend (stages 0-3)"
- [ ] Убедиться что `git status` чистый перед стартом refresh tokens

---

### Шаг 1 — Backend: переменные окружения и JWT утилита ✅

- [x] В `.env` добавить `JWT_ACCESS_SECRET` и `JWT_REFRESH_SECRET`, удалить `JWT_SECRET`
- [x] `utils/jwt.ts` — разделить: `generateToken` / `verifyToken` (24ч, `JWT_ACCESS_SECRET`) и `generateRefreshToken` / `verifyRefreshToken` (30д, `JWT_REFRESH_SECRET`); имена доступа сохранены для совместимости с `authController.ts`
- [x] Проверить что mini-app токены (`telegramAuth`) используют тот же `JWT_ACCESS_SECRET` — `generateToken` теперь использует `JWT_ACCESS_SECRET`, всё работает

---

### Шаг 2 — Backend: схема и миграция ✅

- [x] `schema.prisma` — добавить модель `RefreshToken` (поля: `id`, `token` hash, `userId`, `expiresAt`, `revoked`, `revokedAt DateTime?`, `createdAt`) + back-relation на `User`
- [x] Создать и применить миграцию `20260710000000_add_refresh_tokens` (без `migrate dev`)

---

### Шаг 3 — Backend: CORS + cookie-parser ✅

- [x] `pnpm add cookie-parser @types/cookie-parser` в `apps/backend`
- [x] `index.ts` — заменить `app.use(cors())` на настройку с `ADMIN_CORS_ORIGINS` из env + `credentials: true` + явный `allowedHeaders` включая `X-Requested-With`
- [x] `index.ts` — добавить `app.use(cookieParser())`

---

### Шаг 4 — Backend: обновить `POST /auth/verify-code` ✅

- [x] После успешной проверки OTP: создать `RefreshToken` в БД (хранить SHA-256 hash)
- [x] Установить cookie `refresh_token`: `httpOnly`, `secure`, `sameSite: 'lax'`, `path: '/auth'`, `maxAge: 30d`
- [x] Тело ответа прежнее: `{ token, user }` (access token — без изменений)
- [x] Добавить probabilistic GC (5% шанс): удалить просроченные `RefreshToken`, не блокировать ответ

---

### Шаг 5 — Backend: новый `POST /auth/refresh` ✅

- [x] Читать токен из `req.cookies.refresh_token`
- [x] Проверить CSRF-заголовок `X-Requested-With: XMLHttpRequest` — иначе 403
- [x] Найти запись в БД, проверить `revoked` и `expiresAt`
- [x] Grace-период 15 сек: если `revoked && revokedAt > now - 15s` — выдать новый access token без ротации (concurrent refresh от другой вкладки)
- [x] Пометить старый токен `revoked = true`, `revokedAt = now()`
- [x] Создать новый refresh token в БД, выставить новую cookie
- [x] Вернуть `{ token }` (новый access token)
- [x] Добавить GC (5%) — fire-and-forget, не блокирует ответ

---

### Шаг 6 — Backend: новый `POST /auth/logout` ✅

- [x] Проверить CSRF-заголовок
- [x] Найти и отозвать refresh token из cookie (`revoked = true`)
- [x] Очистить cookie: `res.clearCookie('refresh_token', { path: '/auth' })`
- [x] Вернуть `{ ok: true }`

---

### Шаг 7 — Backend: удалить `queryToken` из auth middleware ✅

- [x] `middlewares/auth.ts` — убрать ветку `queryToken` (`?token=` в query-параметрах)

---

### Шаг 8 — Backend: зарегистрировать новые роуты ✅

- [x] В файле роутов `/auth` добавить `POST /auth/refresh` и `POST /auth/logout`
- [x] Оба роута — без `requireAuth` (рефреш вызывается до получения access token)

---

### 🚀 ДЕПЛОЙ 1 — только бэкенд

> ⚠️ Breaking change: на сервере переименовать `JWT_SECRET` → `JWT_ACCESS_SECRET`, добавить `JWT_REFRESH_SECRET`. Все активные сессии будут инвалидированы. Пользователи получат 401 и окажутся на логине. Деплой фронта должен последовать в течение нескольких минут.

- [ ] Обновить `.env` на сервере через `nano`
- [ ] Задеплоить бэкенд (pm2 restart)
- [ ] Проверить: `POST /auth/refresh` и `POST /auth/logout` доступны
- [ ] Проверить: старые запросы с `?token=` возвращают 401

---

### Шаг 9 — Frontend: `AuthContext` ✅

- [x] Создать `src/contexts/AuthContext.tsx`
- [x] Хранить `accessToken` в `useRef` (не `useState`) — изменения токена не вызывают ре-рендер
- [x] Экспортировать: `getToken()`, `setToken(t)`, `clearToken()`, `triggerForceLogout(reason)`
- [x] `AuthProvider` размещён внутри `BrowserRouter` для доступа к `useNavigate`

---

### Шаг 10 — Frontend: `fetchWithAuth` ✅

- [x] Создать `src/api/fetchWithAuth.ts`
- [x] К обычным запросам: `Authorization: Bearer <token>`; к `/auth/refresh` и `/auth/logout`: `credentials: 'include'` + `X-Requested-With: XMLHttpRequest`
- [x] `initFetchAuth(deps)` — инъекция auth-функций из AuthContext без circular imports
- [x] При 401: single-flight mutex (`refreshPromise`) — первый запрос делает refresh, остальные ждут в одном Promise
- [x] После успешного refresh: повтор оригинального запроса с новым токеном
- [x] При неудачном refresh: `triggerForceLogout('expired')` → toast → navigate('/login')

---

### Шаг 11 — Frontend: Bootstrap (восстановление сессии после F5) ✅

- [x] Создать `src/hooks/useAuthBootstrap.ts`
- [x] При маунте: `POST /auth/refresh` → `GET /auth/me` с `credentials: 'include'`
- [x] Успех → `setToken` + `setUser` + `setIsAuthenticated(true)` → роутер рендерится
- [x] Ошибка → `setIsAuthenticated(false)` → RequireAuth редиректит на `/login` без тоста
- [x] Спиннер только если запрос занимает > 150мс (таймер setTimeout 150ms)
- [x] `aria-live="polite"` + `aria-label="Восстановление сессии..."` на контейнере спиннера

---

### Шаг 12 — Frontend: multi-tab через `BroadcastChannel` ✅

- [x] При успешном refresh в `fetchWithAuth`: слать `TOKEN_REFRESHED` в `BroadcastChannel('auth_channel')`
- [x] В `AuthContext` useEffect: подписаться — при `TOKEN_REFRESHED` обновлять tokenRef
- [x] При `LOGOUT`: `triggerForceLogout('other_tab')` → toast "Вы вышли в другой вкладке." → navigate('/login')
- [x] При явном logout из Sidebar: `clearToken()` + broadcast `LOGOUT` + navigate без тоста

---

### Шаг 13 — Frontend: Login.tsx и api/auth.ts ✅

- [x] `Login.tsx` — убран `localStorage.setItem('jwt_token')`, заменён на `setToken` + `setUser` + `setIsAuthenticated(true)` из контекста
- [x] `api/auth.ts` — `getMe()` использует `fetchWithAuth` вместо localStorage
- [x] `api/auth.ts` — добавлен `logout()` (POST /auth/logout с credentials+CSRF)
- [x] `api/auth.ts` — `verifyCode()` добавлено `credentials: 'include'` (приём refresh cookie)
- [x] `RequireAuth.tsx` — убран localStorage, читает `isAuthenticated` из AuthContext

---

### Шаг 14 — Frontend: `MediaLoader` компонент ✅

- [x] Создать `src/components/MediaLoader/MediaLoader.tsx` (render-prop паттерн)
- [x] `fetchWithAuth` → `res.blob()` → `URL.createObjectURL`
- [x] Cleanup: `URL.revokeObjectURL(createdUrl)` при анмаунте (через closure-переменную)
- [x] Loading state: shimmer skeleton (`MediaLoader.module.css`)
- [x] Error state: иконка ⚠ на месте skeleton

---

### Шаг 15 — Frontend: убрать `?token=` паттерн ✅

- [x] `api/chat.ts` — `getChatFileUrl` больше не добавляет `?token=` в URL (токен идёт через Bearer в `fetchWithAuth`)
- [x] `ChatPanel.tsx` — все медиа-типы (фото, аудио, стикер, видео, документ) через `<MediaLoader>`

---

### Шаг 16 — Frontend: убрать `localStorage` из всех API-файлов ✅

- [x] `api/patterns.ts` — все 12 вызовов переведены на `fetchWithAuth`
- [x] `api/authors.ts` — 4 вызова переведены на `fetchWithAuth`
- [x] `api/users.ts` — переведён на `fetchWithAuth`
- [x] `api/chat.ts` — переведён на `fetchWithAuth`
- [x] `api/dashboard.ts` — переведён на `fetchWithAuth`
- [x] `api/whitelist.ts` — переведён на `fetchWithAuth`
- [x] `components/Sidebar/Sidebar.tsx` — logout переведён с `localStorage.removeItem` на `logout()` + `clearToken()`

---

### Шаг 17 — Frontend: UX форс-логаут ✅

- [x] При истечении сессии (refresh вернул 401): `triggerForceLogout('expired')` → toast "Сессия истекла. Войдите снова." → navigate('/login')
- [x] При `BroadcastChannel LOGOUT` (другая вкладка): `triggerForceLogout('other_tab')` → toast "Вы вышли в другой вкладке." → navigate('/login')
- [x] Явный logout (кнопка Выйти): без тоста, мгновенный navigate('/login')

---

### 🚀 ДЕПЛОЙ 2 — фронтенд

> Делать сразу после Деплоя 1, с минимальным промежутком.

- [ ] Собрать фронт (`npm run build`)
- [ ] Задеплоить на сервер
- [ ] Проверить: F5 на любой странице → сессия восстанавливается
- [ ] Проверить: 2 вкладки, logout в одной → тост в другой

---

### Шаг 18 — Финальная проверка

- [ ] `grep -r "localStorage" apps/admin/src/` — ничего не возвращает
- [ ] `grep -r "?token=" apps/admin/src/` — ничего не возвращает
- [ ] TypeScript компилируется без ошибок
- [ ] F5, мульти-таб, logout — всё работает
- [ ] CORS: запросы с `admin.rapport.su` к `rapport.su` проходят с cookie

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | CORS/credentials blocker resolved, `revokedAt` schema gap fixed, domain confirmed (admin.rapport.su / rapport.su, same site), CSRF header + `?token=` cleanup added |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | Initial score 3/10 → 9/10. Added interaction-state table (bootstrap/media/forced-logout/manual-logout), softened forced-logout UX (2s toast vs instant redirect), skeleton spec for MediaLoader (CLS), aria-live/role=alert for a11y |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**UNRESOLVED:** 0
**VERDICT:** ENG + DESIGN CLEARED — ready to implement.
