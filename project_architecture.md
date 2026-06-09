# Структура проекта и репозитория MVP

Документ описывает оптимальную архитектуру и файловую структуру для проекта, разрабатываемого одним человеком, с использованием современных инструментов (React, Vite, Node.js, Prisma, Docker).

---

## 1. Monorepo или несколько репозиториев (Polyrepo)?

### Вариант А: Раздельные репозитории (Polyrepo)
*   **Плюсы:** Полная изоляция; удобнее деплоить отдельные части независимо (например, фронт на Vercel, бэкенд на VPS).
*   **Минусы:** Сложно синхронизировать типы (TypeScript) между бэкендом и фронтендом; для запуска всего проекта локально нужно открывать 3 терминала и 3 IDE; сложнее рефакторить сквозные фичи.

### Вариант Б: Monorepo (npm / yarn / pnpm workspaces)
*   **Плюсы:** 
    *   Единый запуск всего проекта одной командой (`docker-compose up`).
    *   Общая папка `shared` для хранения TypeScript-интерфейсов (DTO API, Enum), чтобы фронтенд и бэкенд говорили на одном языке.
    *   Один PR для фичи "от базы до кнопок в UI".
    *   Один `.env` файл для локальной разработки.
*   **Минусы:** Незначительно усложняется настройка CI/CD и Dockerfile для сборки, но для деплоя на один VPS через Docker Compose это не проблема.

### 🏆 Рекомендация для соло-разработчика: Monorepo
Для небольшого проекта, который разрабатывает и поддерживает один человек, **Monorepo** с использованием `pnpm workspaces` или `npm workspaces` — идеальный вариант. Это в разы ускорит разработку и избавит от боли рассинхронизации API.

---

## 2. Общая структура каталогов (Monorepo)

```text
/knitting-catalog-app (Корень проекта)
├── /apps                     # Исполняемые приложения
│   ├── /backend              # Node.js + Express
│   ├── /frontend-miniapp     # React + Vite (пользовательский интерфейс)
│   └── /frontend-admin       # React + Vite (панель управления)
├── /packages                 # Переиспользуемые модули
│   └── /shared               # Общие TypeScript типы (DTO API)
├── /docker                   # Конфиги для Docker
│   ├── /nginx                # Настройки реверс-прокси
│   └── /postgres             # init.sql скрипты (если нужно)
├── .env                      # Общий ENV-файл для локальной разработки
├── docker-compose.yml        # Запуск всей инфраструктуры
├── package.json              # Настройка workspaces
└── README.md
```

---

## 3. Структура Backend (`/apps/backend`)

Классическая слоистая архитектура, идеально подходящая для Express + Prisma.

```text
/apps/backend
├── /prisma                   # Конфигурация Prisma (см. п.6)
├── /src
│   ├── /config               # Загрузка .env и глобальные константы
│   ├── /controllers          # Обработчики запросов (парсинг req, вызов сервисов, отправка res)
│   ├── /middlewares          # Авторизация (TG InitData, Admin JWT), обработка ошибок
│   ├── /routes               # Маршрутизация (API endpoints)
│   ├── /services             # Бизнес-логика (работа с Prisma, проверки)
│   ├── /utils                # Вспомогательные функции
│   └── index.ts              # Точка входа в приложение, настройка Express
├── Dockerfile                # Инструкция сборки бэкенда
├── package.json
└── tsconfig.json
```

---

## 4. Структура Frontend Mini App (`/apps/frontend-miniapp`)

Структура, близкая к Feature-Sliced Design (или упрощенная компонентная архитектура).

```text
/apps/frontend-miniapp
├── /public                   # Статика (favicon, манифест)
├── /src
│   ├── /assets               # Иконки, шрифты, глобальные стили CSS
│   ├── /components           # Переиспользуемые UI компоненты (Button, Card, Badge)
│   ├── /hooks                # Кастомные хуки (useTelegramInitData, useTheme)
│   ├── /pages                # Страницы (CatalogPage, PatternDetailsPage, FavoritesPage)
│   ├── /services             # API-клиент (fetch или axios запросы к backend)
│   ├── /store                # Стейт-менеджер (например, Zustand для легкого стейта)
│   ├── /types                # Локальные интерфейсы (или импорт из /shared)
│   ├── App.tsx               # Корневой компонент с React Router
│   └── main.tsx              # Инициализация React и интеграция TG SDK
├── index.html                
├── Dockerfile                # Сборка статики (nginx/alpine)
├── vite.config.ts            
└── package.json
```

---

## 5. Структура Admin Panel (`/apps/frontend-admin`)

Аналогична Mini App, но адаптирована под десктопные таблицы и формы.

```text
/apps/frontend-admin
├── /src
│   ├── /components           # Админские UI (Table, Form, Modal, Sidebar)
│   ├── /pages                # Login, Dashboard, PatternsList, PatternEdit, AuthorsList
│   ├── /hooks                # useAuth
│   ├── /services             # API запросы (с добавлением авторизационного заголовка)
│   ├── App.tsx               
│   └── main.tsx              
├── index.html
├── Dockerfile                
├── vite.config.ts
└── package.json
```

---

## 6. Структура Prisma (`/apps/backend/prisma`)

```text
/apps/backend/prisma
├── schema.prisma             # Итоговая схема базы данных (из прошлого этапа)
├── /migrations               # Папка авто-генерируемых миграций
└── seed.ts                   # Скрипт предзаполнения базы (создание дефолтных тегов, инструментов)
```

---

## 7. Структура конфигурации окружений (`.env`)

Для удобства одного разработчика создается один корневой `.env` файл, значения из которого подтягивает Docker Compose и сервисы.

```env
# ==========================================
# База данных PostgreSQL
# ==========================================
POSTGRES_USER=myuser
POSTGRES_PASSWORD=mypassword
POSTGRES_DB=knitting_db

# ==========================================
# Backend
# ==========================================
DATABASE_URL=postgresql://myuser:mypassword@postgres:5432/knitting_db?schema=public
PORT=3000
JWT_SECRET=super-secret-key
ADMIN_PASSWORD=strong-admin-pass
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11  # Для валидации WebApp InitData

# ==========================================
# Frontend / Admin 
# ==========================================
# Во время сборки Vite использует переменные, начинающиеся с VITE_
VITE_API_URL=https://api.yourdomain.com
```

---

## 8. Структура Docker (`docker-compose.yml`)

Весь проект для production (и локального тестирования приближенного к проду) поднимается одним файлом `docker-compose.yml` в корне:

```yaml
version: '3.8'

services:
  # 1. База данных
  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=${POSTGRES_DB}
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: always

  # 2. Бэкенд
  backend:
    build:
      context: .
      dockerfile: ./apps/backend/Dockerfile
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - PORT=${PORT}
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      - postgres
    restart: always

  # 3. Единый Nginx (Отдает статику фронтов и проксирует API)
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./docker/nginx/nginx.conf:/etc/nginx/nginx.conf
      # Статика билдится локально или в multistage Dockerfile и монтируется сюда
      - ./apps/frontend-miniapp/dist:/usr/share/nginx/html/miniapp
      - ./apps/frontend-admin/dist:/usr/share/nginx/html/admin
    depends_on:
      - backend
    restart: always

volumes:
  pgdata:
```

### Архитектура Nginx:
В Nginx настраиваются правила маршрутизации (в файле `nginx.conf`):
*   `https://api.domain.com/*` -> проксируется на контейнер `backend:3000`
*   `https://admin.domain.com/*` -> отдает статику из папки `/html/admin`
*   `https://app.domain.com/*` -> отдает статику из папки `/html/miniapp`

## Итог

Данная архитектура (Монорепозиторий + Docker Compose + Nginx) — это "золотой стандарт" для небольших стартапов и инди-разработчиков. Она позволяет:
1. Запускать всё одной командой.
2. Не платить за несколько серверов (всё живет на одном VPS Ubuntu).
3. Переиспользовать типы между слоями (что минимизирует баги интеграции).
4. Легко переносить проект с локальной машины на сервер.
