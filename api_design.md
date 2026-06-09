# Проектирование API и проверка схемы БД для MVP

Документ описывает финальную сверку базовой схемы базы данных с потребностями будущего клиентского и административного API, а также приводит структуру REST-эндпоинтов и примеры ответов.

---

## 1. Нужен ли `Pattern.primaryProductTypeId`?

**Ответ: Да, нужен.**
*   **Аргументация:** Если в карточке каталога (в списке) дизайнер предусмотрел только один "главный" бейдж для типа изделия (например, "Джемпер"), то опираться на массив `productTypes` ненадежно. В реляционной базе данных порядок возвращаемых элементов M:N связи не гарантирован без явной сортировки. Добавление `primaryProductTypeId` (внешний ключ на `ProductType`) гарантирует, что контент-менеджер явно укажет главный тип, который 100% корректно отрендерится на карточке.
*   *Дополнение в БД:* 
    ```prisma
    primaryProductTypeId String?
    primaryProductType   ProductType? @relation("PrimaryProduct", fields: [primaryProductTypeId], references: [id])
    // И не забыть добавить в ProductType: primaryFor Pattern[] @relation("PrimaryProduct")
    ```

## 2. Нужно ли добавить `sourceType` для `externalLink`?

**Ответ: Да, настоятельно рекомендуется.**
*   **Аргументация:** С точки зрения UI это даст возможность красиво отрендерить кнопку перехода ("Купить на Boosty", "Перейти в Telegram", "Смотреть на сайте", логотип VK). С точки зрения аналитики администратор сможет видеть, какие платформы генерируют больше всего кликов.
*   *Дополнение в БД:*
    ```prisma
    enum SourceType {
      TELEGRAM
      WEBSITE
      BOOSTY
      VK
      OTHER
    }
    // В Pattern:
    sourceType SourceType @default(OTHER)
    ```

## 3. Один `imageUrl` vs Галерея изображений (`PatternImage`)?

**Ответ: Для MVP абсолютно достаточно одного `imageUrl`.**
*   **Оценка сложности:** Внедрение галереи потребует новой таблицы `PatternImage` (со связью 1:N и полем `order`), усложнит форму в админке (загрузка множества файлов, drag-and-drop сортировка), усложнит API-ответ и фронтенд (внедрение карусели/свайпера).
*   **Оценка выгоды:** Минимальная. Поскольку наш каталог является агрегатором-витриной, чья конечная цель — **увести пользователя по `externalLink`** (на Boosty, ВК или ТГ-канал автора), нам достаточно одной привлекательной обложки. Всю остальную галерею пользователь увидит на целевом ресурсе. Это классический паттерн для MVP-агрегаторов.

---

## 4. Примеры ответов API (JSON)

Ответы проектируются так, чтобы минимизировать вес. В списке каталога возвращаются только те данные, которые нужны для отрисовки карточки.

### 4.1 Список каталога (`GET /api/patterns`)
```json
{
  "data": [
    {
      "id": "uuid-1234",
      "slug": "dzhemper-vesna",
      "title": "Джемпер Весна",
      "imageUrl": "https://s3.example.com/images/vesna.jpg",
      "isFree": false,
      "isNew": true,
      "author": {
        "name": "Анна Вязалова"
      },
      "primaryProductType": {
        "name": "джемпер"
      },
      "isFavorite": true 
    }
  ],
  "meta": {
    "total": 125,
    "page": 1,
    "limit": 10,
    "totalPages": 13
  }
}
```
*(Примечание: флаг `isFavorite` высчитывается на бекенде для текущего авторизованного пользователя, чтобы фронтенду не приходилось делать O(N) проверок)*

### 4.2 Карточка описания (`GET /api/patterns/dzhemper-vesna`)
```json
{
  "id": "uuid-1234",
  "slug": "dzhemper-vesna",
  "title": "Джемпер Весна",
  "description": "Подробное описание теплого весеннего джемпера...",
  "imageUrl": "https://s3.example.com/images/vesna.jpg",
  "externalLink": "https://boosty.to/anna/posts/123",
  "sourceType": "BOOSTY",
  "isFree": false,
  "isNew": true,
  "favoritesCount": 142,
  "isFavorite": true,
  "author": {
    "id": "author-uuid",
    "name": "Анна Вязалова",
    "link": "https://t.me/anna_knits"
  },
  "productTypes": [
    { "id": "uuid-a", "name": "джемпер" }
  ],
  "instruments": [
    { "id": "uuid-b", "name": "спицы" }
  ],
  "tags": [
    { "id": "uuid-c", "name": "ажуры" },
    { "id": "uuid-d", "name": "реглан" }
  ]
}
```

### 4.3 Список избранного (`GET /api/user/favorites`)
Ответ идентичен списку каталога, так как UI карточки в Избранном обычно такой же.
```json
{
  "data": [
    {
      "pattern": {
        "id": "uuid-1234",
        "slug": "dzhemper-vesna",
        "title": "Джемпер Весна",
        "imageUrl": "https://s3.example.com/images/vesna.jpg",
        "isFree": false,
        "isNew": true,
        "author": { "name": "Анна Вязалова" },
        "primaryProductType": { "name": "джемпер" },
        "isFavorite": true
      },
      "addedAt": "2026-06-08T10:00:00Z"
    }
  ],
  "meta": {
    "total": 15,
    "page": 1,
    "limit": 10,
    "totalPages": 2
  }
}
```

---

## 5. Работа поиска (PostgreSQL + Prisma) для MVP

Для каталога размером **200–300 записей** сложные системы типа Elasticsearch или нативный PostgreSQL Full-Text Search (tsvector) будут оверинжинирингом. Стандартный оператор `ILIKE` справится с этой задачей за 1–3 миллисекунды.

В Prisma запрос поиска по трем сущностям (Название, Автор, Тег) будет выглядеть так:

```javascript
// Конфигурация Prisma Query
const patterns = await prisma.pattern.findMany({
  where: {
    isPublished: true,
    OR: [
      { title: { contains: searchQuery, mode: 'insensitive' } },
      { author: { name: { contains: searchQuery, mode: 'insensitive' } } },
      { tags: { some: { name: { contains: searchQuery, mode: 'insensitive' } } } }
    ]
  },
  take: 10,
  skip: (page - 1) * 10,
  orderBy: getSortLogic(filterType), // Все, Новинки и т.д.
});
```
Этот запрос генерирует оптимальный `SQL JOIN` с использованием `ILIKE`. При размере таблицы в 300 строк таблица полностью поместится в кэш RAM базы данных, и ответ будет мгновенным.

---

## 6. REST Endpoints MVP

### Клиентское приложение (Mini App)
*(Доступ только по JWT/Telegram InitData)*

*   `GET /api/patterns` — Каталог (с поддержкой `?page=1&search=...&type=...&instrument=...&tag=...&sort=new|free|all`)
*   `GET /api/patterns/:slug` — Детальная страница описания
*   `GET /api/filters/` — Получение списков `tags`, `productTypes`, `instruments` для UI фильтров
*   `POST /api/patterns/:id/click` — Отстук аналитики (пользователь нажал на кнопку перехода к источнику)
*   `GET /api/user/favorites` — Список избранного
*   `POST /api/user/favorites/:patternId` — Добавить в избранное
*   `DELETE /api/user/favorites/:patternId` — Удалить из избранного

### Административное приложение
*(Доступ по Admin API Key или JWT администратора)*

*   **Auth:**
    *   `POST /api/admin/login` — Вход для получения токена
*   **Patterns (CRUD):**
    *   `GET /api/admin/patterns`
    *   `POST /api/admin/patterns`
    *   `PUT /api/admin/patterns/:id`
    *   `DELETE /api/admin/patterns/:id`
*   **Authors / Tags / Types / Instruments:**
    *   Стандартный CRUD для каждого справочника (например, `POST /api/admin/authors`)
*   **Analytics:**
    *   `GET /api/admin/stats/dashboard` — (Всего юзеров, новых юзеров за неделю, всего кликов, топ-10 популярных)
