# Design System — Rapport Admin

> Источник правды: Figma https://www.figma.com/design/9COGTtzDGVErNHED1K4wHE
> Паттерны собраны с ноды `191:8143` (admin_page) и страницы «Админка» (173:831)

---

## Процесс ревью верстки

1. Получить ссылку с `node-id` от пользователя
2. Запустить `/figma:figma-use`, загрузить `ToolSearch select:get_design_context,get_screenshot,use_figma`
3. `get_screenshot` (enableBase64Response: true) + `use_figma` inspect — параллельно
4. Если нода — PAGE: `setCurrentPageAsync` → найти фрейм среди children → инспектировать
5. Элементы могут лежать вне родительского контейнера (абсолютные оверлеи) — проверять siblings на уровне parent frame
6. Прочитать `.tsx` + `.module.css` реализации
7. Составить таблицу несоответствий: блок / Figma / Код / Критичность
8. Исправить: сначала CSS, затем TSX
9. Не коммитить — решает пользователь

### Что проверять в каждом компоненте

| Свойство | В Figma | В CSS |
|----------|---------|-------|
| Ширина | `node.width` | `width` |
| Фон | `fills[0].color` → hex | `background-color` |
| Граница | `strokes` | `border` |
| Паддинг | `paddingTop/Right/Bottom/Left` | `padding` |
| Gap | `itemSpacing` | `gap` |
| Шрифт | `fontName.family` / `fontName.style` | `font-family` / `font-weight` |
| Размер шрифта | `fontSize` | `font-size` |
| Border-radius | `cornerRadius` | `border-radius` |
| Цвет текста | `fills` на TEXT-ноде | `color` |
| Размер иконки | `width/height` instance | `size={}` в TSX |

---

## Шрифт

**Во всём проекте используется только `Mulish`.**
Если в Figma встречается `Lato` — это ошибка дизайнера, игнорировать.

---

## Цветовая палитра

| Роль | Hex | Применение |
|------|-----|-----------|
| Primary | `#a9ae36` | Активные состояния, кнопка «Добавить», active nav |
| Danger | `#d8520f` | Кнопка «Удалить», logout, rejected-состояния |
| Publish | `#bec1f4` | Кнопка «Опубликовать» (активная) |
| Secondary | `#f3f3f3` | Нейтральные кнопки (Замена кавычек, Справочники) |
| Text primary | `#1d1c1c` | Основной текст |
| Text muted | `#9b9a9a` | Placeholder, вторичный текст |
| White | `#ffffff` | Карточки, инпуты, сайдбар |
| Page bg | `#f9fafb` | Фон основного контента |

---

## Кнопки (`btn` component set)

Все кнопки: **высота 32px**, `border-radius: 2px`, шрифт **Mulish Regular 12px**

| Вариант | Фон | Текст | Использование |
|---------|-----|-------|--------------|
| `btn_add` | `#a9ae36` | `#ffffff` | Добавить описание |
| `publish` | `#bec1f4` | `#1d1c1c` | Опубликовать (активная) |
| `publish_inactive` | `#bec1f4` | `#1d1c1c` | Опубликовать (disabled) |
| `info` | `#f3f3f3` | `#1d1c1c` | Нейтральные действия |
| `info_inactive` | `#f3f3f3` | `#1d1c1c` | Нейтральные (disabled) |
| `delete` | `#d8520f` | `#ffffff` | Удалить |
| `delete_inactive` | `#d8520f` | `#ffffff` | Удалить (disabled) |

Паддинг: `0 12px`, gap иконка-текст: `4px`, иконка: `lucide/plus` 24px

---

## Nav item (`Select` component set)

Размер: **218×38px**, `border-radius: 2px`, паддинг: `7px 12px`, gap: `10px`

| Состояние | Фон | Текст | Вес |
|-----------|-----|-------|-----|
| Default (inactive) | `#ffffff` | `#1d1c1c` | Regular |
| Active | `#a9ae36` | `#ffffff` | Bold |
| Unactive (скоро) | `#ffffff` | `#1d1c1c` | Regular + лейбл «скоро» 12px |

---

## Иконки сайдбара (Lucide React)

**Важно:** В Figma все иконки имеют `strokeWeight: 1`. lucide-react по умолчанию рендерит `strokeWidth={2}` — **всегда** указывать `strokeWidth={1}` явно на всех иконках в проекте.

| Пункт | Figma | lucide-react |
|-------|-------|-------------|
| Описания | `lucide/layout-list` | `LayoutList` |
| Авторы | `lucide/user-round` | `UserRound` |
| Статистика | `lucide/chart-column-stacked` | `ChartColumnStacked` |
| Обращения | `lucide/message-circle-check` | `MessageCircleCheck` |
| Белый список | `lucide/file-user` | `FileUser` |
| Пользователи | `lucide/book-user` | `BookUser` |
| Справочник | `lucide/info` | `Info` |
| Выход | `lucide/log-out` | `LogOut` |

---

## Поле поиска (`searc` component)

- Высота: **40px**, ширина: **400px**
- Паддинг: `8px 20px`
- Шрифт: Mulish 15px Regular
- Placeholder цвет: `#9b9a9a`
- Фон: `#ffffff`
- Radius: `2px`
- Иконки справа: `lucide/search` size=24 strokeWidth=1 + `lucide/x` (очистка, только при наличии текста) size=16 strokeWidth=1

---

## Input field (`Form_Element`)

- Высота: **41px**
- Паддинг: `12px 16px`
- Шрифт: Mulish 14px
- Заполненный: Bold `#1d1c1c`
- Пустой (placeholder): Regular `#9b9a9a`
- Radius: `2px`

---

## Табы (`tabs` component set)

- Шрифт: Mulish 14px **Bold**
- Цвет: `#1d1c1c`
- Счётчик: фон `#e5e5e5`, radius `2px`
- Активный таб: подчёркивание снизу

---

## Чекбокс (`lucide_check` component set)

Figma: `node-id=173-831` (страница «Админка»), компонент `lucide_check` → COMPONENT_SET
Иконки: `Designe/lucide/square-check.svg` (checked), `Designe/lucide/square-uncheck.svg` (unchecked)

Нативный `<input type="checkbox">` **не используется**. Заменяется кастомным компонентом `CheckboxIcon`.

| Свойство | Значение |
|----------|---------|
| Контейнер | 24×24px |
| Иконка (vector) | 18×18px, viewBox 0 0 32 32 |
| Stroke (оба состояния) | `#1D1C1C`, strokeLinecap: round, strokeLinejoin: round |
| Checked | квадрат + галочка (`square-check.svg`) |
| Unchecked | пустой квадрат со скруглёнными углами (`square-uncheck.svg`) |

```tsx
function CheckboxIcon({ checked, onChange }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)}
      style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
               display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24 }}>
      {checked ? (
        <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
          <path d="M12 16L14.6667 18.6667L20 13.3333M6.66667 4H25.3333C26.8061 4 28 5.19391 28 6.66667V25.3333C28 26.8061 26.8061 28 25.3333 28H6.66667C5.19391 28 4 26.8061 4 25.3333V6.66667C4 5.19391 5.19391 4 6.66667 4Z"
                stroke="#1D1C1C" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
          <path d="M25.3333 4H6.66667C5.19391 4 4 5.19391 4 6.66667V25.3333C4 26.8061 5.19391 28 6.66667 28H25.3333C26.8061 28 28 26.8061 28 25.3333V6.66667C28 5.19391 26.8061 4 25.3333 4Z"
                stroke="#1D1C1C" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  );
}
```

---

## Аудит компонентизации (итерация 1)

Статус: **вынесен в компонент** ✅ / **инлайн** ❌

| # | Элемент | Статус | Где живёт |
|---|---------|--------|-----------|
| 1 | Сайдбар | ✅ Вынесен | `components/Sidebar/Sidebar.tsx`, монтируется через `layouts/AdminLayout.tsx` |
| 2 | Header (заголовок + поиск + счётчик строк) | ✅ Вынесен | `components/PageHeader/PageHeader.tsx` — используется на всех страницах; `search` необязателен |
| 3 | Control panel (фильтры / табы + кнопки действий) | ❌ Per-page | Оставить инлайн — контент слишком разный; соблюдать визуальный стандарт (см. ниже) |
| 4 | Строка описания (вкладки Опубликованные / Архивные) | ✅ Вынесена | `pages/Patterns/PatternCard.tsx` → `PatternCard` + `PatternCardHeader` |
| 5 | Карточка описания на вкладке «На модерации» (у админа) | ✅ Вынесена | `pages/Patterns/ModerationCard.tsx` + `ModerationCard.module.css` |
| 6 | Строка автора (страница Авторы) | ✅ Вынесена | `pages/Authors/AuthorRow.tsx` — flex-строка, `AuthorRow` + `AuthorRowHeader`; таблица удалена |
| 7 | Строка пользователя (страница Пользователи) | ✅ Вынесена | `pages/Users/UserRow.tsx` — flex-строка, `UserRow` + `UserRowHeader`; таблица удалена |

### Примечания

- `PatternCard` — пример правильного разделения: строка данных + строка заголовка как отдельные компоненты.
- `AuthorRow` / `UserRow` — flex вместо `<table>`: нет `colgroup`, нет глобальных CSS-селекторов, CSS-переменные наследуются через DOM-каскад.
- `UserRow.module.css` использует `var(--pad-cell-v)`, `var(--c-title)` и др. — они задаются на `.container` в `Users.module.css` и каскадируют вниз.

---

## План компонентизации (итерация 1)

---

### 1. PageHeader → `components/PageHeader/PageHeader.tsx`

**Статус:** ✅ реализован

**Проблема.** Хедер (заголовок + поиск + счётчик) продублирован в трёх файлах под разными именами:

| Страница | Класс-обёртка | Счётчик | Разрыв от Figma |
|----------|---------------|---------|-----------------|
| `Patterns.tsx` | `.headerRow` + `.headerLeft` | есть (`totalCount` с label + value) | поиск 400px, иконки Search 24px |
| `Authors.tsx` | `.headerRow` | нет | поиск без иконки X, Search 18px (не 24px) |
| `Users.tsx` | `.topBar` + `.topLeft` | есть | поиск Search 18px (не 24px) |

**Интерфейс компонента:**
```ts
interface PageHeaderProps {
  title: string                          // "Описания" / "Авторы" / "Пользователи"
  search: {
    value: string
    onChange: (v: string) => void
    placeholder?: string                 // по умолчанию "Поиск"
  }
  totalCount?: {
    label: string                        // "Всего описаний:" / "Всего пользователей:"
    value: number | null
  }
}
```

**Что переносится в компонент:**
- CSS из `Patterns.module.css`: `.pageTitle`, `.headerRow`, `.headerLeft`, `.searchWrapper`, `.searchInput`, `.searchInput::placeholder`, `.searchIcons`, `.searchClear`, `.totalCount`, `.totalCountLabel`, `.totalCountValue`
- Логика кнопки очистки (X при `search.value !== ""`)
- Иконка Search 24px strokeWidth=1 цвет `#9b9a9a` — единый размер для всех страниц

**Что меняется в потребителях:**
- `Patterns.tsx` — удалить JSX блока `headerRow`, импортировать `PageHeader`
- `Authors.tsx` — удалить `headerRow`, добавить `totalCount={undefined}` (или без prop)
- `Users.tsx` — удалить `topBar`, импортировать `PageHeader`

---

### 2. Control Panel — анализ выноса

**Статус:** ✅ решение принято — оставить per-page

**Текущий вид на трёх страницах:**

| Страница | Левая часть | Правая часть |
|----------|-------------|-------------|
| `Patterns.tsx` | 3 таба (Опубликованные / Архивные / На модерации + бейдж) | 5 кнопок (Добавить, Сбросить isNew, Замена кавычек, Справочники, Удалить выбранные) |
| `Authors.tsx` | пустая `<div>` | 1 кнопка (Добавить автора) |
| `Users.tsx` | компонент отсутствует | — |

**Плюсы выноса:**
- Один файл задаёт визуальный стиль панели (фон, рамка, паддинги) → при дизайн-изменении правка в одном месте
- Гарантирует консистентность оступов и рамки между страницами

**Минусы выноса:**
- Контент принципиально разный: табы со статусом+бейджом vs кнопка vs отсутствие
- Компонент сводится к тонкой обёртке с двумя слотами `left` и `right` — это стилизованный `<div>`, почти не несущий бизнес-логики
- Каждый потребитель всё равно передаёт уникальный JSX в слоты → дублирование не устраняется, только перемещается
- Добавляет лишний уровень вложенности и импорт ради 4 строк CSS

**Заключение:** не выносить. Вместо этого зафиксировать визуальный стандарт в DESIGN_SYSTEM как именованный паттерн и применять его через локальный CSS в каждой странице.

**Визуальный стандарт Control Panel:**
```
background: #ffffff
border: 1px solid #e5e5e5
border-radius: 2px
padding: 20px 26px
display: flex; justify-content: space-between; align-items: center
```

---

### 3. ModerationCard → `pages/Patterns/ModerationCard.tsx`

**Статус:** ✅ реализован

**Проблема.** ~70 строк JSX и 17 CSS-классов для карточки черновика живут прямо в `Patterns.tsx` / `Patterns.module.css` внутри блока `status === "moderation"`.

**Интерфейс компонента:**
```ts
interface ModerationCardProps {
  draft: DraftPattern          // существующий тип из api/patterns
  onApprove: (id: string) => Promise<void>
  onReject: (draft: DraftPattern) => void
}
```

**Что переносится:**
- JSX: весь блок `<div className={styles.draftCard}>...</div>` (~строки 467–534 Patterns.tsx)
- CSS: все классы с префиксом `draft` (`.draftCard`, `.draftCardImg`, `.draftCardBody`, `.draftCardTitle`, `.draftCardMeta`, `.draftCardEdit`, `.draftCardTags`, `.draftTag`, `.draftCardFlags`, `.draftFlag`, `.draftCardUrl`, `.draftCardActions`, `.draftApproveBtn`, `.draftRejectBtn`) → в новый `ModerationCard.module.css`

**Что остаётся в Patterns.tsx:**
- `.moderationGrid` (контейнер-грид для карточек)
- Логика загрузки черновиков (`draftsLoading`, `drafts`, `loadDrafts`)
- `setRejectingDraft` — передаётся как `onReject`
- После замены: `drafts.map(draft => <ModerationCard draft={draft} onApprove={...} onReject={...} />)`

**Расположение:** рядом с `PatternCard.tsx` (в `pages/Patterns/`), не в `components/` — используется только на этой странице.

---

### 4. AuthorRow → `pages/Authors/AuthorRow.tsx`

**Статус:** ✅ реализован

**Проблема.** Строки авторов рендерятся как `<tr>` внутри `<table>` в `Authors.tsx`. Таблица не адаптивна, нет возможности применить резиновые размеры через flex/grid.

**Структура строки (3 колонки из Figma):**

| Колонка | Содержимое | Flex |
|---------|------------|------|
| Имя | `author.name`, текст bold | `flex: 3 1 0` |
| Описаний | `author.patternsCount`, число | `flex: 1 1 0` |
| Действия | кнопки SquarePen + Trash2 | `flex: 0 0 80px` |

**Компоненты:**
- `AuthorRow` — строка данных, пропсы: `author: AuthorItem`, `onEdit`, `onDelete`
- `AuthorRowHeader` — строка заголовков (Имя / Описаний / пустая)

**Что меняется в Authors.tsx:**
- Удалить `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`
- Удалить CSS: `.table`, `.tdText`, `thead th`, `tbody tr`
- Заменить на `<AuthorRowHeader />` + `authors.map(a => <AuthorRow ... />)`
- Обёртка `.tableWrapper` остаётся, но становится flex-колонкой

**Расположение:** `pages/Authors/AuthorRow.tsx` + `pages/Authors/AuthorRow.module.css`

---

### 5. UserRow → `pages/Users/UserRow.tsx`

**Статус:** ✅ реализован

**Проблема.** `<tr>` рендерится инлайн в `Users.tsx`. Текущий `<table>` с `table-layout: fixed` требует `<colgroup>` для резиновых колонок, что неудобно. Flex-строка решает это нативно.

**Структура строки (7 колонок из Figma, пропорции 203:182:80:228:158:54:24):**

| Колонка | Содержимое | Flex |
|---------|------------|------|
| Имя | `fullName(u)`, bold | `flex: 2.24 1 0` |
| Username | `@username`, muted | `flex: 2.01 1 0` |
| Роль | цветной текст (USER/AUTHOR/ADMIN) | `flex: 0.88 1 0` |
| Имя автора | `author.name`, bold | `flex: 2.52 1 0` |
| Последний вход | дата, muted | `flex: 1.75 1 0` |
| Избранное | Heart + count | `flex: 1 1 0` (увеличен для текста заголовка) |
| Редактировать | SquarePen | `flex: 0 0 40px` |

**Компоненты:**
- `UserRow` — строка данных, пропсы: `user: AdminUser`, `onClick`, `onEdit`
- `UserRowHeader` — строка заголовков с сортировкой, пропсы: `sortBy`, `sortOrder`, `onSort`

**Что меняется в Users.tsx:**
- Удалить `<table>`, `<colgroup>`, `<thead>`, `<tbody>` и все дочерние теги
- Удалить CSS: `table`, `col.*`, `thead th`, `tbody tr`, `tbody td`, `.colName` и т.д.
- Заменить на `<UserRowHeader ... />` + `users.map(u => <UserRow ... />)`
- `SortIcon` — перенести в `UserRow.tsx` (нужен только там)
- `ROLE_LABELS`, `ROLE_CLASS` — перенести в `UserRow.tsx`

**Расположение:** `pages/Users/UserRow.tsx` + `pages/Users/UserRow.module.css`

---

### Порядок реализации

1. `PageHeader` — самый широкий эффект (3 страницы), делать первым
2. `ModerationCard` — изолированный рефакторинг, не затрагивает другие страницы
3. `AuthorRow` — замена таблицы, затрагивает только Authors.tsx
4. `UserRow` — замена таблицы, затрагивает только Users.tsx
5. Control Panel — не реализовывать, только соблюдать визуальный стандарт

---

## Сайдбар (административная версия)

- Ширина: **218px**, фон: `#ffffff`, без border-right
- Логотип: x=30, y=40, высота 45px
- Gap от логотипа до nav: **117px**
- Nav gap между items: **4px**
- Logout: отступ от нижнего края сайдбара **30px**, padding: **11px 26px**
- Шрифт logout: Mulish (не Lato — ошибка дизайнера)
