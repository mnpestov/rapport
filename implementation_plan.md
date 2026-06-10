# План запуска проекта в Telegram Mini App (MVP)

Этот план описывает минимально необходимые шаги для превращения текущего веб-приложения в полноценный Telegram Mini App с реальной авторизацией, без изменения общей архитектуры.

## Аудит текущего состояния

**Что уже реализовано:**
- Frontend (React + Vite) успешно интегрирован с backend (Express).
- Приложение работает через единый домен `https://rapport.su` с проксированием `/patterns` и `/auth` (CORS не требуется, пути относительные).
- Созданы заглушки для роута `/auth/telegram` (как на фронте, так и на бэкенде). 

**Чего не хватает (Mandatory Steps):**
- Подключения скрипта `telegram-web-app.js`.
- Инициализации Mini App при старте (`ready()`, `expand()`).
- Передачи реального `initData` с клиента на сервер.
- Серверной валидации подписи `initData` (HMAC-SHA256) с использованием `BOT_TOKEN`.
- Конфигурации самого бота в Telegram (@BotFather).

> [!IMPORTANT]
> Для MVP логика авторизации будет просто проверять валидность подписи от Telegram. Если подпись верна, пользователь получает доступ (флаг `isSubscriber: true`). Управление реальными подписками можно будет накрутить поверх позже.

## Open Questions

> [!WARNING]
> У вас уже есть созданный бот в Telegram и полученный `BOT_TOKEN`? Для работы бэкенда потребуется добавить этот токен в `apps/backend/.env`.

## Proposed Changes

---

### Frontend

Изменения на клиенте для инициализации TWA и отправки реальных данных.

#### [MODIFY] [index.html](file:///Users/mihailpestov/Desktop/dev/ai-dev/miniApp_UU/apps/frontend-miniapp/index.html)
Добавление официального скрипта Telegram в `<head>`:
```html
<script src="https://telegram.org/js/telegram-web-app.js"></script>
```

#### [MODIFY] [authApi.ts](file:///Users/mihailpestov/Desktop/dev/ai-dev/miniApp_UU/apps/frontend-miniapp/src/api/authApi.ts)
Изменение функции `authenticate`, чтобы она принимала `initData` в качестве аргумента, вместо отправки жестко закодированной строки `"mock"`.

#### [MODIFY] [App.tsx](file:///Users/mihailpestov/Desktop/dev/ai-dev/miniApp_UU/apps/frontend-miniapp/src/App.tsx)
1. Вызов инициализации при загрузке:
   - `const tg = (window as any).Telegram?.WebApp;`
   - `tg?.ready();`
   - `tg?.expand();`
2. Извлечение `tg?.initData` и передача его в функцию `authenticate(initData)`. 
3. Если `initData` пустой (например, запуск в браузере вне Telegram), можно оставить fallback или сразу показывать заглушку, но для тестов оставим моковый fallback при локальной разработке.

---

### Backend

Реализация безопасной проверки данных, полученных от Telegram.

#### [MODIFY] [authController.ts](file:///Users/mihailpestov/Desktop/dev/ai-dev/miniApp_UU/apps/backend/src/controllers/authController.ts)
1. Удаление текущего мока.
2. Реализация алгоритма валидации `initData` от Telegram:
   - Парсинг `initData` (превращение URLSearchParams в отсортированный по алфавиту `data_check_string`).
   - Получение `secret_key` через HMAC-SHA256 хеширование `BOT_TOKEN` со строкой `"WebAppData"`.
   - Хеширование `data_check_string` полученным ключом и сравнение с `hash` из `initData`.
3. При успешной валидации: парсинг поля `user` (id, first_name) и возврат успешного ответа.

#### [MODIFY] .env
Добавление переменной `BOT_TOKEN` (токен вашего бота от @BotFather).

---

## Настройка Telegram (BotFather)

Шаги, которые вам нужно будет выполнить самостоятельно:
1. Открыть `@BotFather` и выбрать вашего бота.
2. Выполнить команду `/setmenubutton`.
3. Указать URL: `https://rapport.su`.
4. (Опционально) Настроить Short Name (например, `myapp`) через команду `/newapp`, чтобы приложение запускалось по ссылке вида `t.me/your_bot/myapp` (так называемые Direct Link / startapp).

## Verification Plan

### Manual Verification
1. Деплой обновленного фронтенда и бэкенда на сервер.
2. Добавление `BOT_TOKEN` в `.env` на сервере.
3. Открытие бота с телефона (iOS / Android) и нажатие кнопки Menu.
4. Убедиться, что интерфейс открывается на весь экран (`expand()`).
5. Проверка того, что загружается реальный каталог описаний (означает, что авторизация через `initData` прошла успешно).
