# Процесс: бэкофилл галереи фото по авторам

Этот файл описывает текущий итеративный процесс добавления фото (до 5 на
описание) для паттернов, у которых сейчас только 1 фото. Ориентирован на
то, чтобы **любая модель**, не видевшая предыдущих сессий, могла подключиться
к работе и продолжить её без потери контекста и без повторения уже
найденных и исправленных ошибок.

Смежные файлы:
- [backfill_pattern_images.py](backfill_pattern_images.py) — сам бэкофилл
  (галерея → скачивание → запись в локальную БД).
- [generate_prod_images_backfill.py](generate_prod_images_backfill.py) —
  генератор SQL-патча и списка файлов для переноса на прод, для ОДНОГО уже
  проверенного автора.
- [../../../../pattern_images_plan.md](../../../../pattern_images_plan.md) —
  план изначальной фичи "несколько фото у описания" (схема `images: String[]`,
  лимит `MAX_PATTERN_IMAGES = 5`, разделение `/images/patterns/` от
  `/uploads/patterns/`). Читать для контекста модели данных, но это ДРУГАЯ
  задача (уже реализована и задеплоена) — не путать с этим бэкофиллом.
- [DETAILS_PRICE_PARSING_PROCESS.md](DETAILS_PRICE_PARSING_PROCESS.md) —
  аналогичный по духу процесс для `details`/`price`/`oldPrice`, откуда
  позаимствован общий стиль работы (по одному автору за раз, живая
  проверка, локально → прод).

## Зачем это нужно

На момент написания у **2786 из 2788** паттернов (99.9%) ровно 1 фото.
Задача — довести до 5 (где реально столько есть на сайте автора), используя
уже существующие в скрапере механизмы извлечения галереи, которые
**уже вычисляются** при обычном парсинге детальной страницы, но раньше
никогда не сохранялись (см. раздел "Откуда взялась галерея" ниже).

## Жёсткие ограничения (дословно от пользователя, не подлежат пересмотру без явного разрешения)

1. **Подгружаем фото только по тем авторам, по которым уже работает скрапер
   поиска новинок.** Не берём авторов "на удачу" — сначала подтвердить, что
   основной sync-механизм (`author_sync.py main()`) реально работает по
   сайту этого автора (см. шаг 2 в раннере ниже).
2. **По одному автору за раз.** Не пытаться сразу обработать всех
   авторов/все 2786 паттернов одним прогоном.
3. **Не больше 5 фото на паттерн.** Обложка (`images[0]`) всегда сохраняется,
   остальные слоты (до 4 новых) заполняются из галереи сайта.
4. **Берём только паттерны, опубликованные ИЛИ архивные на ПРОДЕ** (т.е.
   строка `Pattern` реально существует на проде — не важно, `isVisible=true`
   или `false`/архив). Паттерны, которые есть ТОЛЬКО в локальной dev БД (и
   никогда не были залиты на прод), не в скоупе этой задачи.
5. **Скрапер поиска новинок (`author_sync_lib/`, живой sync-пайплайн) НЕ
   редактируется.** Вся новая логика — в отдельном, самостоятельном скрипте,
   который **читает/импортирует** существующие функции скрапера
   (`_generic_extract_gallery`, `_get_crawl_hooks`, и т.п.), но не меняет ни
   строчки в `author_sync_lib/main.py`, `hooks.py`, `handlers.py`,
   `crawlers.py`.
6. **На прод модель НИЧЕГО сама не заливает и не меняет.** Ни `git
   commit`/`push`, ни `scp`/`rsync` на прод-сервер, ни `psql`-запись на
   прод-БД. Финальный шаг — всегда точные команды, которые выполняет
   пользователь сам.
7. **Проверка — сначала в локальной БД.** Загрузили фото и записали в
   локальную БД/файловую систему → сказали пользователю, что готово к
   визуальной проверке → пользователь сам открывает и смотрит глазами (см.
   `feedback_no_self_browser_qa.md` в памяти — модель НЕ открывает браузер
   сама для самопроверки этой фичи, ждёт обратной связи текстом).
8. **Минимальные затраты токенов на максимум покрытия.** Не переусложнять:
   переиспользовать существующие в скрапере механизмы там, где они уже
   работают, не писать site-specific парсеры "про запас", не делать лишних
   раундов ревью там, где можно один раз откалибровать метрику и полагаться
   на неё дальше (см. дедуп ниже).

## Откуда взялась галерея (важно понимать, прежде чем трогать код)

Функция `fetch_and_parse_detail()` в `crawlers.py` — та же, что уже
использовалась для бэкофилла `details`/`price`/`oldPrice` — **уже** кладёт
полную галерею в `p['images']` как побочный эффект обычного парсинга
детальной страницы (`crawlers.py:71`, `gallery = (gallery_hook(...) if
gallery_hook else None) or _generic_extract_gallery(detail_soup)`). Это
просто никогда не сохранялось в БД — `backfill_details()` в `main.py`
читает из результата только `details`/`price`/`oldPrice`, `images`
отбрасывается.

Три источника галереи, по убыванию точности:
1. **Site-specific хук `extract_gallery`** в `DOMAIN_CRAWL_HOOKS` (сейчас
   только `hollywool.ru`, `eiwi.ru`).
2. **Tilda Store API** (`_tilda_store_images()` в `handlers.py`) — для
   авторов из `SITE_HANDLERS`/`SUPPLEMENTAL_STORE_HANDLERS` (kitirrr.ru,
   tsinbal.ru, bysergeeva.ru, lavkabulavka.com, knithappens.ru, foxknit.ru,
   lenakotikova.ru, likavyazhi.ru, loonymax.tilda.ws,
   viktoria-morozova.ru) — API отдаёт полную галерею одним вызовом.
   **⚠️ Текущая версия `backfill_pattern_images.py` этот путь НЕ
   использует** — она всегда идёт прямым fetch страницы товара (см.
   "Известные ограничения" ниже). Для этих ~217 паттернов скрипт нужно
   будет расширить batch-логикой из `backfill_details()` (main.py,
   `site_handler`/`handler_items`) — не переизобретать, скопировать тот же
   паттерн подбора (`match = next((it for it in handler_items if
   get_base_url(...) == target_base), None)`), но **в новом файле**, не
   трогая `main.py` (см. правило 5).
3. **Generic fallback** `_generic_extract_gallery()` в `hooks.py` —
   универсальный сборщик (lightbox-разметка, Vigbo CDN `data-base-path`/
   `data-file-name`, WooCommerce-галерея, generic-слайдеры), покрывает
   большинство остальных авторов best-effort. Возвращает до 12 URL.

## Два скрипта

### `backfill_pattern_images.py`

```bash
cd apps/backend/src/scripts
DATABASE_URL="postgresql://postgres:postgres@localhost:5434/knitting_catalog" \
  python3 backfill_pattern_images.py "Имя Автора"
```

Что делает, по шагам:
1. Находит автора по имени (`Author.name`, точное совпадение), берёт
   `site`.
2. Выбирает все `Pattern` этого автора с `array_length(images,1) <= 1`
   (или `images IS NULL`), **плюс** (с добавлением `thumbnailUrl`, см.
   image_pipeline_plan.md) паттерны с уже полной галереей, но пустым
   `"thumbnailUrl"` — этот третий OR-филиал существует только для
   ретроактивного бэкофилла thumbnail на уже полностью обработанных
   авторах, сама галерея (шаги 3-6 ниже) для таких строк — no-op
   (`len(new_images) > len(existing_images)` остаётся `False`). Паттерны,
   у которых уже 2+ фото **и** `thumbnailUrl` заполнен, скрипт не трогает
   вообще — безопасно перезапускать на уже полностью обработанном авторе.
3. Для каждого паттерна: скачивает страницу товара (`requests.get`),
   чистит `soup` (убирает `nav/header/footer/aside/script/style/title` и
   всё с классом, содержащим `related` — те же шаги, что в
   `fetch_and_parse_detail`), достаёт галерею через site-specific хук
   (если есть) или `_generic_extract_gallery`.
4. Качает кандидатов по одному, **не более 4 новых** (итог ≤ 5 вместе с
   обложкой), с дедупом по перцептивному хэшу (см. следующий раздел —
   **обязательно прочитать перед любыми правками этой части**).
5. Новые файлы кладутся в `apps/backend/public/images/patterns/`
   (тот же каталог, что и обычный скрапер-контент — НЕ
   `uploads/patterns/`, это отдельный каталог для ручных загрузок через
   админку) с именем `{slug паттерна}-{номер}.{расширение}` (например,
   `kanna-top-iiaks-2.jpeg`). `slug` берётся из уже существующей колонки
   `Pattern.slug` (гарантированно уникальна на всю БД — `@unique` в
   схеме), так что коллизий имён файлов не бывает.
6. Обновляет `Pattern.images` (полный массив: старая обложка + новые).
   `imageUrl`/`images[0]` **не трогается**.
7. Печатает построчный отчёт (`url: N -> M images`) и итоговую сводку
   (`updated`/`no_new`/`errors`/`thumbnails_generated`).
8. Если у паттерна `"thumbnailUrl"` пуст — генерирует его из **существующей**
   обложки (`images[0]`, никогда не из свежескачанных) через
   `generate_thumbnail_url()`, читающей общий `image-pipeline.config.json`
   (тот же файл читает Node-сторона, `apps/backend/src/utils/imagePipeline.ts`
   — единый источник правды по размеру/качеству/формату, см.
   image_pipeline_plan.md). Не зависит от того, нашлась ли новая галерея —
   выполняется отдельным шагом до неё.

### ⚠️ КРИТИЧЕСКИ ВАЖНО: почему дедуп — по перцептивному хэшу, а не по SHA-256

**Это уже было реальным багом**, найденным пользователем визуально после
первого прогона на двух авторах ("в некоторых описаниях первые 2 фото
дублируются"). Причина: CDN (в частности Vigbo, `cdn-sh1.vigbo.com` —
на iiaks.ru и staryxo-knit.com) отдаёт **одну и ту же фотографию в разных
разрешениях по разным URL** (например, размер-ключ `"2"` = 683×1024 для
обложки, взятой когда-то с листинговой страницы, и размер-ключ `"3"` =
1365×2048 для той же самой фотографии в галерее детальной страницы).
Байты у этих файлов **полностью разные** (разное разрешение → разное
сжатие) — точный побайтовый/SHA-256-хэш их не различает как дубликаты, и
первая версия скрипта (на SHA-256) исправно скачивала "новую" фотографию,
которая на самом деле была той же обложкой в другом размере.

**Исправление** — перцептивный хэш (dHash, разностный хэш 8×8 через
`PIL.Image`, см. функции `dhash_of_bytes`/`dhash_of_file`/`hamming`/
`is_duplicate` в скрипте). dHash **устойчив к масштабированию и пересжатию**
— уменьшает картинку до маленького эскиза перед сравнением, поэтому один и
тот же кадр в разных разрешениях даёт почти нулевое расстояние Хэмминга.

**Порог `DUPLICATE_THRESHOLD = 6`** откалиброван вживую на реальных данных
(Юлия Устинова + Юлия Старикова, 98 паттернов, 391 файл) тремя явно
разделёнными кластерами:

| Что сравнивалось | Расстояние Хэмминга | Вывод |
|---|---|---|
| Обложка vs та же фотография другого размера (подтверждённый дубль) | **0–6** | дубликат |
| Обложка-скриншот (`Снимок_экрана_*.png`, см. ниже) vs реальное фото из галереи | 7–10 | **НЕ дубликат** (случайное структурное сходство) |
| Две разные реальные фотографии товара | 22–37 | не дубликат |

Порог 6 сидит ровно между первым и вторым кластером с запасом. **Если в
будущем захочется потрогать порог — сначала пересчитать эти три кластера
заново на новых данных** (см. скрипт-аудит в разделе "Обязательная проверка
после прогона" ниже), не менять число вслепую.

**Что дедуп проверяет:** каждый новый скачанный кандидат сравнивается (а)
с хэшем существующей обложки (посчитанным с диска один раз в начале
обработки паттерна) и (б) со всеми уже принятыми в рамках ЭТОГО ЖЕ
паттерна кандидатами. Если расстояние Хэмминга до любого из них ≤ 6 —
кандидат отбрасывается, файл не сохраняется.

### `generate_prod_images_backfill.py`

```bash
cd apps/backend/src/scripts
DATABASE_URL="postgresql://postgres:postgres@localhost:5434/knitting_catalog" \
  python3 generate_prod_images_backfill.py "Имя Автора" /путь/к/выходной/папке
```

Берёт **все** паттерны автора с непустым `images` из локальной БД (не
только те, что скрипт выше только что трогал — так что если для автора уже
было 5 фото до этого запуска, они тоже попадут в SQL, что безопасно и
идемпотентно) и пишет два файла в указанную папку:

- **`prod_images_backfill.sql`** — `UPDATE "Pattern" SET images = ...,
  "imageUrl" = ... WHERE url = ...` для каждого паттерна, обёрнутый в
  `BEGIN;`/`COMMIT;`. Сопоставление **по `url`, не по `id`** (id на проде и
  локально — разные записи разных окружений, тот же принцип, что и в
  `generate_prod_backfill_sql.py` для details/price). Экранирование —
  через `cursor.mogrify` (psycopg2), не ручная сборка строк — не менять на
  f-строки, это открывает дыру для SQL-инъекции через некорректно
  экранированные кавычки в URL/путях.
- **`new_images_files.txt`** — список **только новых** файлов (basename,
  без пути), то есть `images[1:]` каждого паттерна — `images[0]`
  (обложка) туда никогда не попадает, она уже есть на проде и её трогать
  не нужно.

## Шаг 0 (ОБЯЗАТЕЛЕН, перед любым автором): синхронизация локальной БД с продом

**Локальная БД со временем отстаёт от прода** — на проде продолжают
появляться новые одобренные паттерны (через `processSyncBatch`, минуя
локальную машину), а их файлы фото никогда не попадают в локальную
файловую систему. Если это не проверить заранее, тут возможны два разных
по природе, но одинаково ломающих раннер провала:

1. **Паттерн есть на проде, но отсутствует в локальной БД целиком** — шаг 3
   раннера (сверка URL) правильно исключит его из скоупа, но исключит
   ОШИБОЧНО: паттерн реально существует и опубликован на проде (проходит
   правило 4), просто ещё не синхронизирован локально. Не чинить — значит
   недобирать охват на пустом месте.
2. **Паттерн есть в локальной БД, но файл(ы) его `images[]` физически
   отсутствуют на диске** — при просмотре в мини-аппе/админке локально
   отдаётся `404` вместо картинки (это уже было реальным багом, найденным
   пользователем визуально: "проблема с ошибками загрузки фото в локальной
   бд" — причина ровно та же: паттерны/файлы копировались с прода
   частично, DB-строка скопирована, файл — нет).

**Правило:** перед тем как переходить к Шагу 1 нового автора — прогнать обе
проверки ниже. Не обязательно каждый раз при каждом перезапуске в рамках
одной сессии, но обязательно если: (а) прошло много времени с прошлой
проверки, (б) вы видите "накопилось много описаний без фото" от
пользователя, (в) вы не уверены, когда это проверялось в последний раз.

### 0.1. Проверить и импортировать паттерны, отсутствующие в локальной БД

```bash
SCRATCH=<scratch-директория>   # НЕ /tmp — использовать выданную для сессии scratchpad-папку

# Полное множество URL на проде и локально
docker exec -i miniapp_uu-db-1 psql -U postgres -d knitting_catalog -t -A -c \
  'SELECT url FROM "Pattern" WHERE url IS NOT NULL' | sort -u > "$SCRATCH/local_urls_all.txt"

ssh app@5.129.246.160 "psql 'postgresql://kurgidb:kurgiDB12@127.0.0.1:5432/knitting_catalog' -t -A -c \"
SELECT url FROM \\\"Pattern\\\" WHERE url IS NOT NULL
\"" | sort -u > "$SCRATCH/prod_urls_all.txt"

comm -23 "$SCRATCH/prod_urls_all.txt" "$SCRATCH/local_urls_all.txt" > "$SCRATCH/missing_in_local.txt"
wc -l "$SCRATCH/missing_in_local.txt"
```

Если файл пустой — локальная БД полная, переходить к 0.2. Если нет —
импортировать построчно через `\copy` (не вручную собирать `INSERT`
командой из множества строк — Cyrillic/JSON-массивы в тексте почти
гарантированно что-нибудь сломают при ручном экранировании):

```bash
# 1. Собрать SQL-массив URL для WHERE (экранирование одинарных кавычек)
python3 -c "
urls = [u for u in open('$SCRATCH/missing_in_local.txt').read().split(chr(10)) if u]
esc = lambda u: u.replace(chr(39), chr(39)*2)
arr = ','.join(f\"'{esc(u)}'\" for u in urls)
open('$SCRATCH/urls_array.txt','w').write(arr)
"
ARR=$(cat "$SCRATCH/urls_array.txt")

# 2. Экспортировать строки Pattern с прода (\copy ... TO STDOUT — избегает
#    ручного экранирования полностью, включая text[]-массив images)
cat > "$SCRATCH/export.sql" <<SQLEOF
\copy (SELECT id,slug,title,url,"imageUrl","isFree","createdAt","updatedAt","authorId","isVisible","isNew","densityRows","densityStitches",images,"publishedAt",details,"oldPrice",price FROM "Pattern" WHERE url = ANY(ARRAY[$ARR])) TO STDOUT
SQLEOF
ssh app@5.129.246.160 "psql 'postgresql://kurgidb:kurgiDB12@127.0.0.1:5432/knitting_catalog'" < "$SCRATCH/export.sql" > "$SCRATCH/patterns.copy"
```

**⚠️ Прежде чем импортировать — две проверки, обе реально случались:**

- **Коллизия по `id` с другим `url`.** Один и тот же паттерн (тот же `id`)
  мог поменять `url` на проде (например, автор пересохранил товар с новым
  hash-route на Tilda) уже после того, как локальная копия была сделана —
  тогда `comm` покажет его как "отсутствующий" (по старому URL совпадения
  нет), хотя на самом деле это уже существующая локально строка. Прямой
  `\copy ... FROM` в этом случае упадёт с `duplicate key value violates
  unique constraint "Pattern_pkey"`. Проверить ДО импорта:
  ```bash
  cut -f1 "$SCRATCH/patterns.copy" | sort -u > "$SCRATCH/incoming_ids.txt"
  docker exec -i miniapp_uu-db-1 psql -U postgres -d knitting_catalog -t -A -c \
    'SELECT id FROM "Pattern"' | sort -u > "$SCRATCH/local_ids_all.txt"
  comm -12 "$SCRATCH/incoming_ids.txt" "$SCRATCH/local_ids_all.txt"
  ```
  Для каждого найденного id — не импортировать заново, а `UPDATE
  "Pattern" SET url='<новый url с прода>' WHERE id='<id>'` локально, и
  убрать эту строку из `patterns.copy` (`grep -v "^<id>"`) перед импортом
  остальных.
- **Автор с тем же именем, но другим `id` (или другим именем при том же
  сайте).** Окружения могли разойтись: автор был переименован на проде
  после того, как локальная копия создавалась независимо (не через
  единый sync), и в итоге `Author.id` в прод-строке Pattern не существует
  локально → `Pattern_authorId_fkey` завалит импорт. Прежде чем
  импортировать паттерны конкретного автора — свериться:
  ```sql
  -- на проде и локально, сравнить по каждому автору из missing_in_local.txt
  SELECT id, name, site FROM "Author" WHERE name = '<Имя с прода>';
  ```
  Если `id` не совпадает — искать локального автора **по `site` URL**, не
  по имени (имя может расходиться, домен — почти никогда). Если нашёлся —
  заменить `authorId` в соответствующих строках `patterns.copy` на
  локальный id (колонка 9, считая с 1, tab-separated) перед импортом:
  ```bash
  python3 -c "
  lines = open('$SCRATCH/patterns.copy').read().split(chr(10))
  out = []
  for l in lines:
      if not l: continue
      parts = l.split(chr(9))
      if parts[8] == '<prod authorId>':
          parts[8] = '<local authorId>'
      out.append(chr(9).join(parts))
  open('$SCRATCH/patterns.copy','w').write(chr(10).join(out) + chr(10))
  "
  ```
  Если локального автора с таким `site` нет вообще — это уже не задача
  синхронизации фото, а отдельный вопрос (заводить нового автора) — не
  импровизировать, спросить пользователя.

Импорт (после того как оба пункта выше проверены/исправлены):

```bash
docker cp "$SCRATCH/patterns.copy" miniapp_uu-db-1:/tmp/patterns.copy
cat > "$SCRATCH/import.sql" <<'SQLEOF'
\copy "Pattern" (id,slug,title,url,"imageUrl","isFree","createdAt","updatedAt","authorId","isVisible","isNew","densityRows","densityStitches",images,"publishedAt",details,"oldPrice",price) FROM '/tmp/patterns.copy'
SQLEOF
docker cp "$SCRATCH/import.sql" miniapp_uu-db-1:/tmp/import.sql
docker exec -i miniapp_uu-db-1 psql -U postgres -d knitting_catalog -f /tmp/import.sql
```

**Не забыть связи** (категории/теги/инструменты/диапазоны пряжи) — это
отдельные join-таблицы, `\copy` строки `Pattern` их не переносит
автоматически. Словари (`ProductType`/`Tag`/`Instrument`/`YarnRange`)
проверены — их `id` совпадают между прод и локальной БД один в один, так
что связи переносятся впрямую, без ремаппинга:

```bash
cut -f1 "$SCRATCH/patterns.copy" | sort -u > "$SCRATCH/imported_ids.txt"
python3 -c "
ids = [i for i in open('$SCRATCH/imported_ids.txt').read().split(chr(10)) if i]
open('$SCRATCH/imported_ids_array.txt','w').write(','.join(f\"'{i}'\" for i in ids))
"
# Формат "таблица:колонка-с-Pattern.id" — колонка ПРОВЕРЕНА через
# \d "<table>" (искать fkey на "Pattern"), не угадана по алфавиту:
# у трёх из четырёх это A, у _InstrumentToPattern — B.
for rel in "_PatternToProductType:A" "_PatternToTag:A" "_InstrumentToPattern:B" "_PatternToYarnRange:A"; do
  table="${rel%%:*}"; col_filter="${rel##*:}"
  ARR=$(cat "$SCRATCH/imported_ids_array.txt")
  echo "\\copy (SELECT * FROM \"$table\" WHERE \"$col_filter\" = ANY(ARRAY[$ARR])) TO STDOUT" > "$SCRATCH/export_rel.sql"
  ssh app@5.129.246.160 "psql 'postgresql://kurgidb:kurgiDB12@127.0.0.1:5432/knitting_catalog'" < "$SCRATCH/export_rel.sql" > "$SCRATCH/rel_${table}.copy"
  docker cp "$SCRATCH/rel_${table}.copy" miniapp_uu-db-1:/tmp/rel_${table}.copy
  echo "\\copy \"$table\" (\"A\",\"B\") FROM '/tmp/rel_${table}.copy'" > "$SCRATCH/import_rel.sql"
  docker cp "$SCRATCH/import_rel.sql" miniapp_uu-db-1:/tmp/import_rel.sql
  docker exec -i miniapp_uu-db-1 psql -U postgres -d knitting_catalog -f /tmp/import_rel.sql
done
```

Проверить итог: `comm -23 "$SCRATCH/prod_urls_all.txt" <(локальные url
заново)` должен быть пустым.

### 0.2. Проверить и докачать отсутствующие ФАЙЛЫ фото (тот же 404-баг, теперь как рутинная проверка)

Тот же принцип, что уже применялся один раз точечно — теперь как
стандартный шаг перед началом работы с автором, не только "по жалобе":

```bash
cd apps/backend

# Все пути картинок, на которые ссылается локальная БД
docker exec -i miniapp_uu-db-1 psql -U postgres -d knitting_catalog -t -A -c \
  'SELECT DISTINCT unnest(images) FROM "Pattern" WHERE images IS NOT NULL' \
  > "$SCRATCH/db_referenced_all.txt"

# Отдельно /images/patterns/ (скрапер) и /uploads/patterns/ (ручная загрузка) — разные каталоги
grep '^/images/patterns/' "$SCRATCH/db_referenced_all.txt" | sed 's#^/images/patterns/##' | sort -u > "$SCRATCH/db_images.txt"
grep '^/uploads/patterns/' "$SCRATCH/db_referenced_all.txt" | sed 's#^/uploads/patterns/##' | sort -u > "$SCRATCH/db_uploads.txt"

ls public/images/patterns | sort -u > "$SCRATCH/disk_images.txt"
ls uploads/patterns | sort -u > "$SCRATCH/disk_uploads.txt"

comm -23 "$SCRATCH/db_images.txt" "$SCRATCH/disk_images.txt" > "$SCRATCH/missing_images.txt"
comm -23 "$SCRATCH/db_uploads.txt" "$SCRATCH/disk_uploads.txt" > "$SCRATCH/missing_uploads.txt"
wc -l "$SCRATCH/missing_images.txt" "$SCRATCH/missing_uploads.txt"
```

Если оба файла пустые — всё синхронизировано, можно переходить к Шагу 1.
Если нет — сверить с продом (какие из отсутствующих реально существуют
там). Обычно почти все находятся и просто копируются (см. команду ниже),
но иногда файл отсутствует **и на проде тоже** — это не баг синхронизации,
а уже существующий на проде битый путь в `Pattern.images`/`imageUrl`
(было как минимум одно подтверждённое: `viajeuvie-viajeuvie-tokio_socks.jpg`,
паттерн «Tokio» у Юлии Рубленовой — файл нигде не существует физически, ни
локально, ни на проде). Такие — не чинить копированием (нечего копировать),
а сообщить пользователю списком, это отдельная задача очистки прод-данных.

```bash
scp "$SCRATCH/missing_images.txt" "$SCRATCH/missing_uploads.txt" app@5.129.246.160:/tmp/
ssh app@5.129.246.160 '
cd /var/www/rapport/apps/backend
for pair in "images:public/images/patterns" "uploads:uploads/patterns"; do
  tag="${pair%%:*}"; dir="${pair##*:}"
  > "/tmp/found_${tag}.txt"; > "/tmp/notfound_${tag}.txt"
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if [ -f "$dir/$f" ]; then echo "$f" >> "/tmp/found_${tag}.txt"
    else echo "$f" >> "/tmp/notfound_${tag}.txt"; fi
  done < "/tmp/missing_${tag}.txt"
  echo "$tag: found=$(wc -l < /tmp/found_${tag}.txt) not_found=$(wc -l < /tmp/notfound_${tag}.txt)"
done
'
scp app@5.129.246.160:/tmp/found_images.txt app@5.129.246.160:/tmp/found_uploads.txt app@5.129.246.160:/tmp/notfound_images.txt "$SCRATCH/"
cat "$SCRATCH/notfound_images.txt"   # эти — сообщить пользователю отдельно, не чинить молча

rsync -avz --files-from="$SCRATCH/found_images.txt" \
  app@5.129.246.160:/var/www/rapport/apps/backend/public/images/patterns/ \
  public/images/patterns/
rsync -avz --files-from="$SCRATCH/found_uploads.txt" \
  app@5.129.246.160:/var/www/rapport/apps/backend/uploads/patterns/ \
  uploads/patterns/
```

Это **чтение с прода (scp/rsync pull) + запись только в локальную
файловую систему** — не запись на прод и не изменение прод-БД, поэтому (в
отличие от `git`/деплоя) выполняется моделью самостоятельно, без передачи
пользователю (см. правило 6 — оно про запись НА прод, не про чтение
С прода).

## Пошаговый раннер — по одному автору (строго по порядку)

### Шаг 1. Найти автора, получить `site`

```sql
SELECT id, name, site FROM "Author" WHERE name ILIKE '%Фамилия%';
```
(через `docker exec -i miniapp_uu-db-1 psql -U postgres -d knitting_catalog -c "..."`)

### Шаг 2. Подтвердить, что скрапер новинок реально работает по этому автору

Правило 1 требует это ПЕРЕД запуском бэкофилла. Основной способ:

```sql
SELECT s.status, COUNT(*)
FROM "AuthorSyncItem" s
JOIN "AuthorSyncReport" r ON r.id = s."reportId"
WHERE r."authorId" = '<author_id>'
GROUP BY s.status;
```

Если есть строки (`PENDING`/`REJECTED`/`APPROVED`) — краулер уже находил
паттерны этого автора, можно уверенно продолжать.

**Если 0 строк** (как оказалось у Юлии Стариковой — отчёт мог быть
расчищен через "Очистить" в админке, `clearSyncReport` удаляет
`PENDING`/`APPROVED`, оставляя только `REJECTED`, если такие были, иначе
пусто) — это НЕ обязательно значит, что краулер не работает, но
формальное доказательство отсутствует. В этом случае — живая
подстраховка:
```bash
curl -s -A "Mozilla/5.0 ..." "https://<сайт автора>" -o /tmp/check_home.html
grep -o 'href="[^"]*<характерный кусок пути товара>[^"]*"' /tmp/check_home.html | sort -u
```
Если на главной/листинговой странице статически (без JS) видны прямые
ссылки на товары — генерик-краулер сможет их найти, механизм совместим.
**Явно сообщить пользователю**, что для этого автора формальной истории
`AuthorSyncItem` нет и вывод сделан по прямой проверке, а не по истории —
это решение "по существу", не по букве правила, пользователь должен иметь
возможность его оспорить.

### Шаг 3. Сверить с прод-БД — какие паттерны реально там есть (правило 4)

```bash
ssh app@5.129.246.160 "psql 'postgresql://kurgidb:kurgiDB12@127.0.0.1:5432/knitting_catalog' -t -A -F'|' -c \"
SELECT p.url, p.\\\"isVisible\\\"
FROM \\\"Pattern\\\" p
JOIN \\\"Author\\\" a ON a.id = p.\\\"authorId\\\"
WHERE a.name = 'Имя Автора'
\""
```

Сравнить множество URL с локальным (`SELECT url FROM "Pattern" WHERE
"authorId"='...'`) через `python3 -c "print(set(a)-set(b)); print(set(b)-set(a))"`
или аналогично.

- Если множества **совпадают** (как было у обеих Юлий) — фильтровать
  нечего, можно просто запускать бэкофилл на всех паттернах автора
  локально.
- Если в локальной БД есть паттерны, которых **нет на проде вообще** —
  это не блокирует прогон технически (SQL на шаге "Шаг 6" для
  несуществующего на проде `url` просто даст `UPDATE 0`, безвредный
  no-op — тот же паттерн, что уже был принят как норма в бэкофилле
  details/price для ~41 паттерна, существующего только локально). НО
  **по правилу 4 такие паттерны вне скоупа задачи** — если их много,
  разумнее исключить их ДО запуска `backfill_pattern_images.py` (не тратить
  сетевые запросы/токены на паттерны, которые заведомо не нужны), например
  временно отфильтровав по списку прод-URL перед вызовом скрипта, либо
  прогнав скрипт как есть и просто не перенося эти конкретные строки в
  прод-SQL вручную. Выбор способа — на усмотрение того, кто выполняет,
  главное — не потерять этот шаг проверки.
- **isVisible не имеет значения на этом шаге** — и `true` (опубликован), и
  `false` (архив) одинаково входят в скоуп по правилу 4. Значение
  `isVisible` полезно только для общей картины, не для фильтрации.

### Шаг 4. Живая проверка галереи (дёшево, но экономит откат при провале шага 5)

Взять один реальный URL паттерна автора, скачать (`curl`), прогнать через
`_generic_extract_gallery` (или site-specific хук) в интерактивном
Python — убедиться, что находится >1 картинки и они реально относятся к
товару (не "похожие товары"/чужой контент). Пример — см. историю чата,
проверка на `iiaks.ru`/`staryxo-knit.com` живьём подтвердила Vigbo CDN и
работающий `_generic_extract_gallery` без единой правки в hooks.py.

### Шаг 5. Прогнать бэкофилл на ЛОКАЛЬНУЮ БД

```bash
cd apps/backend/src/scripts
DATABASE_URL="postgresql://postgres:postgres@localhost:5434/knitting_catalog" \
  python3 backfill_pattern_images.py "Имя Автора"
```

Проверить сводку в конце: `errors=0`. Если `errors>0` — разобраться
поштучно (обычно сетевые таймауты/недоступные URL), скрипт делает
`conn.rollback()` только для упавшего паттерна, остальные уже
закоммичены построчно (`conn.commit()` после каждого успешного `UPDATE`)
— безопасно перезапустить тот же вызов, уже обработанные (2+ фото)
паттерны не тронутся повторно.

### Шаг 6. ОБЯЗАТЕЛЬНАЯ проверка на дубликаты (не пропускать, даже если "и так должно быть ок")

Это именно тот шаг, которого не хватало в первом прогоне и который привёл
к найденному пользователем багу. После шага 5 — **всегда** прогнать аудит
дубликатов по всем паттернам автора (можно за один раз по всем уже
обработанным авторам сразу):

```python
import psycopg2, os
from PIL import Image
from itertools import combinations

def dhash(path, hash_size=8):
    try:
        img = Image.open(path).convert('L').resize((hash_size+1, hash_size), Image.LANCZOS)
    except Exception:
        return None
    pixels = list(img.getdata())
    bits = []
    for row in range(hash_size):
        for col in range(hash_size):
            left = pixels[row*(hash_size+1)+col]
            right = pixels[row*(hash_size+1)+col+1]
            bits.append(1 if left < right else 0)
    return bits

def hamming(a, b):
    return sum(x != y for x, y in zip(a, b))

conn = psycopg2.connect("postgresql://postgres:postgres@localhost:5434/knitting_catalog")
cur = conn.cursor()
cur.execute('SELECT a.name, p.url, p.images FROM "Pattern" p JOIN "Author" a ON a.id=p."authorId" WHERE a.name = %s', ("Имя Автора",))
for name, url, images in cur.fetchall():
    hashes = [dhash(os.path.join("public", "images", "patterns", os.path.basename(r))) for r in images]
    for i, j in combinations(range(len(hashes)), 2):
        if hashes[i] is None or hashes[j] is None:
            continue
        d = hamming(hashes[i], hashes[j])
        if d <= 6:
            print(f"ДУБЛЬ: {name} | {url} | img{i+1} vs img{j+1} dist={d}")
```
(запускать из `apps/backend`, чтобы относительный путь `public/images/patterns`
резолвился верно)

**Если аудит нашёл хоть одну строку — не переходить к шагу 8 (генерация
прод-артефактов).** Порядок восстановления — см. раздел "Как откатить и
переделать автора" ниже.

### Шаг 7. Точечная проверка файлов (быстрая, не обязательна, но дешёвая подстраховка)

```bash
docker exec -i miniapp_uu-db-1 psql -U postgres -d knitting_catalog -t -A -c \
  "SELECT unnest(images) FROM \"Pattern\" WHERE url='<любой url этого автора>'"
```
Убедиться, что каждый путь реально существует на диске
(`apps/backend/public/images/patterns/<basename>`) и имеет разумный
размер (не 0 байт, не HTML-страница ошибки, сохранённая как ".jpg").

### Шаг 8. Сгенерировать прод-артефакты

```bash
cd apps/backend/src/scripts
DATABASE_URL="postgresql://postgres:postgres@localhost:5434/knitting_catalog" \
  python3 generate_prod_images_backfill.py "Имя Автора" /path/to/scratch/output_dir
```

### Шаг 9. Провалидировать SQL локально (dry-run через идемпотентность)

Файл только что сгенерирован из текущего состояния локальной БД — повторное
применение к ней же должно быть чистым no-op-подтверждением (`N UPDATE 1`,
без ошибок):
```bash
docker exec -i miniapp_uu-db-1 psql -U postgres -d knitting_catalog -f - < /path/to/output_dir/prod_images_backfill.sql
```
Ожидается ровно `N UPDATE 1` (N = число паттернов автора), никаких `ERROR`.

Подготовить dry-run вариант (тот же файл, но `COMMIT;` → `ROLLBACK;` на
последней строке) — для прогона на ПРОДЕ перед реальной записью:
```bash
sed '$s/COMMIT;/ROLLBACK;/' prod_images_backfill.sql > prod_images_backfill.dryrun.sql
```

### Шаг 10. Подготовить и отдать пользователю команды на прод (сам не выполнять — правило 6)

Ровно 5 шагов, в этом порядке (файлы должны попасть на прод РАНЬШЕ, чем
применится SQL — иначе на проде на несколько секунд будет 404 на новые
фото):

```bash
# 1. Новые файлы на прод (обложки НЕ трогаем — их там уже нет смысла перезаливать)
rsync -avz --files-from="/path/to/output_dir/new_images_files.txt" \
  /Users/mihailpestov/Desktop/dev/ai-dev/miniApp_UU/apps/backend/public/images/patterns/ \
  app@5.129.246.160:/var/www/rapport/apps/backend/public/images/patterns/

# 2. SQL-файлы на прод
scp /path/to/output_dir/prod_images_backfill.sql app@5.129.246.160:/tmp/prod_images_backfill_<автор>.sql
scp /path/to/output_dir/prod_images_backfill.dryrun.sql app@5.129.246.160:/tmp/prod_images_backfill_<автор>.dryrun.sql

# 3. Бэкап таблицы Pattern на проде
ssh app@5.129.246.160 "pg_dump 'postgresql://kurgidb:kurgiDB12@127.0.0.1:5432/knitting_catalog' -t '\"Pattern\"' > /tmp/pattern_backup_before_images_<автор>_\$(date +%Y%m%d_%H%M%S).sql"

# 4. Dry-run — ожидаем "N UPDATE 1", без ошибок
ssh app@5.129.246.160 "psql 'postgresql://kurgidb:kurgiDB12@127.0.0.1:5432/knitting_catalog' -f /tmp/prod_images_backfill_<автор>.dryrun.sql" | sort | uniq -c

# 5. Реальное применение (только после того, как шаг 4 подтвердил ожидаемый результат)
ssh app@5.129.246.160 "psql 'postgresql://kurgidb:kurgiDB12@127.0.0.1:5432/knitting_catalog' -f /tmp/prod_images_backfill_<автор>.sql"
```

**scp с несколькими файлами и разными именами назначения — раздельными
вызовами** (одной командой `scp file1 file2 dest` нельзя переименовать при
копировании — `dest` в этом случае обязан быть директорией). Это уже было
ошибкой в одной из первых версий передаваемых пользователю команд —
исправлено, но при повторной генерации команд с нуля легко наступить на
те же грабли повторно.

### Шаг 11. Дождаться подтверждения пользователя

Не считать автора завершённым, пока пользователь не подтвердил визуальную
проверку локально (правило 7) И не выполнил прод-команды сам. Обновить
таблицу статусов ниже.

## Как откатить и переделать автора (если аудит на шаге 6 нашёл дубли, или вообще что-то пошло не так)

Локальная БД — песочница, откат простой и безопасный:

```bash
# 1. Удалить лишние файлы с диска (всё, кроме обложки, для этого автора)
docker exec -i miniapp_uu-db-1 psql -U postgres -d knitting_catalog -t -A -c "
SELECT unnest(images[2:5]) FROM \"Pattern\" WHERE \"authorId\"='<author_id>' AND array_length(images,1) > 1
" | while read -r rel; do
  [ -z "$rel" ] && continue
  rm -f "apps/backend/public/images/patterns/$(basename "$rel")"
done
```
```sql
-- 2. Откатить images в БД до одной обложки
UPDATE "Pattern" SET images = images[1:1]
WHERE "authorId"='<author_id>' AND array_length(images,1) > 1;
```
Затем повторить с шага 5 (после того как причина дублей/ошибки понятна и
устранена — например, если это снова окажется проблема дедупа, сначала
пересчитать три калибровочных кластера на новых данных, не просто
перезапускать с тем же порогом вслепую).

## Известные проблемы данных — НЕ чинить их в рамках этой задачи

- **Обложка-скриншот.** У части паттернов Юлии Стариковой `images[0]` —
  файл вида `Снимок_экрана_2026-05-29_в_15.17.46.png` (скриншот экрана,
  не фото товара). Обнаружено случайно при калибровке дедупа (см. таблицу
  выше, кластер 7–10). Это отдельная, не связанная с этой задачей проблема
  данных (вероятно, ручной ввод админом) — **не трогать**, не заменять, не
  переоткрывать вопрос без отдельного запроса от пользователя. Единственное,
  что с этим нужно делать в рамках ЭТОЙ задачи — не путать такие случаи с
  настоящими дублями при калибровке/отладке дедупа.

## Известные ограничения текущей версии скрипта (не баги, а осознанно отложенное на потом — см. правило 8)

- **Tilda Store API авторы (~217 паттернов) не поддержаны.** Список:
  kitirrr.ru, tsinbal.ru, bysergeeva.ru, lavkabulavka.com, knithappens.ru,
  foxknit.ru, lenakotikova.ru, likavyazhi.ru, loonymax.tilda.ws,
  viktoria-morozova.ru. Для JSON-API-only доменов (kitirrr.ru, tsinbal.ru,
  knithappens.ru, foxknit.ru) прямой fetch страницы товара (то, что
  сейчас единственно делает скрипт) отдаёт пустую JS-оболочку — генерик
  fallback найдёт 0 фото. Когда до этих авторов дойдёт очередь — нужно
  добавить в `backfill_pattern_images.py` (не в `main.py`!) ту же
  batch-логику подбора по `url`, что уже есть в `backfill_details()`
  (см. `main.py`, переменные `site_handler`/`handler_items`/`match`), и
  доставать `images` из результата `_tilda_store_images()` вместо
  `fetch_and_parse_detail`.
- **11 паттернов без `Author.site` вообще** — бэкофиллить нечем, сайта нет,
  пропускать безусловно.
- **~2388 паттернов на чистом generic-fallback** — покрытие не
  гарантировано, часть сайтов может не дать ни одного нового фото (это
  нормально и ожидаемо, не баг) — по каждому такому автору всё равно
  проходить шаги 1–4 (особенно живую проверку галереи, шаг 4) перед тем,
  как тратить полный прогон на весь список паттернов автора.

## Окружение — справочник

| Что | Значение |
|---|---|
| Локальная БД | `postgresql://postgres:postgres@localhost:5434/knitting_catalog` (Docker `miniapp_uu-db-1`) — свободная песочница, пишем без ограничений |
| Прод SSH | `ssh app@5.129.246.160` |
| Прод БД (только после SSH, изнутри сервера) | `postgresql://kurgidb:kurgiDB12@127.0.0.1:5432/knitting_catalog` — **только read-only SELECT** напрямую, любые записи — только через заранее подготовленный SQL-файл, который выполняет сам пользователь |
| Прод корень приложения | `/var/www/rapport` |
| Прод каталог фото-от-скрапера | `/var/www/rapport/apps/backend/public/images/patterns/` |
| Локальный каталог фото-от-скрапера | `apps/backend/public/images/patterns/` |
| Каталог ручных загрузок (НЕ трогаем в этой задаче) | `apps/backend/uploads/patterns/` (и на проде: `/var/www/rapport/apps/backend/uploads/patterns/`) |

## Границы ответственности (важно, дублирует правила 5–7 выше в более общей формулировке проекта)

- **Прод-БД — только чтение** напрямую (SSH + `psql`, read-only SELECT).
  Любая запись на прод — только через заранее подготовленный и вручную
  запущенный пользователем SQL-файл.
- **Локальная dev БД и файловая система** — можно писать свободно, это
  песочница.
- **Деплой/`git`/`scp`/`rsync` на прод-сервер всегда делает сам
  пользователь.** Модель готовит точный список команд, но не выполняет их.
- Скрапер новинок (`author_sync_lib/`) — read-only источник переиспользуемых
  функций для этой задачи, не редактируется.

## Статус по авторам

Отмечать здесь после каждого завершённого автора (по аналогии с
`author_parsing_checklist.md`).

| Автор | Паттернов | Локально готово | Аудит дублей (шаг 6) | Прод-артефакты сгенерированы | Залито на прод |
|---|---|---|---|---|---|
| Екатерина Сергеева | 14 | ✅ (загружено 46 фото для 14 описаний) | ✅ чисто (0 дублей) | ✅ (`46` новых файлов) | ⏳ ожидает выполнения пользователем |
| Leya_koss | 11 | ✅ (загружено 41 фото для 11 описаний) | ✅ чисто (0 дублей) | ✅ (`41` новых файлов) | ⏳ ожидает выполнения пользователем |
| LikeWool | 11 | ✅ (загружено 36 фото для 11 описаний) | ✅ чисто (0 дублей) | ✅ (`36` новых файлов) | ⏳ ожидает выполнения пользователем |
| Алена Халявина | 9 | ✅ (загружено 14 фото для 9 описаний) | ✅ чисто (0 дублей) | ✅ (`14` новых файлов) | ⏳ ожидает выполнения пользователем |
| Анжелика Белика | 8 | ✅ (загружено 31 фото для 8 описаний) | ✅ чисто (0 дублей) | ✅ (`31` новых файлов) | ⏳ ожидает выполнения пользователем |
| Белинская Лиза | 8 | ✅ (загружено 28 фото для 8 описаний) | ✅ чисто (0 дублей) | ✅ (`28` новых файлов) | ⏳ ожидает выполнения пользователем |
| Sash Koff | 7 | ✅ (загружено 28 фото для 7 описаний) | ✅ чисто (0 дублей) | ✅ (`28` новых файлов) | ⏳ ожидает выполнения пользователем |
| Анастасия Пискунова | 7 | ✅ (загружено 24 фото для 7 описаний) | ✅ чисто (0 дублей) | ✅ (`24` новых файлов) | ⏳ ожидает выполнения пользователем |
| Алла Безгодова | 7 | ✅ (загружено 11 фото для 7 описаний) | ✅ чисто (0 дублей) | ✅ (`11` новых файлов) | ⏳ ожидает выполнения пользователем |
| Анна Иноземцева | 5 | ✅ (загружено 8 фото для 5 описаний) | ✅ чисто (0 дублей) | ✅ (`8` новых файлов) | ⏳ ожидает выполнения пользователем |
| Настя Блошный рынок | 4 | ✅ (загружено 4 фото для 4 описаний) | ✅ чисто (0 дублей) | ✅ (`4` новых файлов) | ⏳ ожидает выполнения пользователем |
| Анна Демидова | 3 | ✅ (загружено 12 фото для 3 описаний) | ✅ чисто (0 дублей) | ✅ (`12` новых файлов) | ⏳ ожидает выполнения пользователем |
| Юлия Вяжет | 2 | ✅ (загружено 0 фото для 2 описаний) | ✅ чисто (0 дублей) | ✅ (`0` новых файлов, sql сгенерирован) | ⏳ ожидает выполнения пользователем |
| Евгения Телегина | 25 | ✅ (загружено 98 фото для 25 описаний) | ✅ чисто (0 дублей) | ✅ (`98` новых файлов) | ✅ (залито) |
| Вера Одинцова Vera knits | 24 | ✅ (загружено 75 фото для 24 описаний) | ✅ чисто (0 дублей) | ✅ (`75` новых файлов) | ✅ (залито) |
| Дарья Малеева (Баруздина) | 23 | ✅ (загружено 92 фото для 23 описаний) | ✅ чисто (0 дублей) | ✅ (`92` новых файлов) | ✅ (залито) |
| Анастасия Соломатова | 23 | ✅ (загружено 90 фото для 23 описаний) | ✅ чисто (0 дублей) | ✅ (`90` новых файлов) | ✅ (залито) |
| Purple Deer Knits /Сиреневый олень вяжет | 23 | ✅ (загружено 80 фото для 20 описаний) | ✅ чисто (0 дублей) | ✅ (`80` новых файлов) | ✅ (залито) |
| katyushaworkshop | 16 | ✅ (загружено 55 фото для 16 описаний) | ✅ чисто (0 дублей) | ✅ (`55` новых файлов) | ✅ (залито) |
| Елена Яковлева | 15 | ✅ (загружено 54 фото для 15 описаний) | ✅ чисто (0 дублей) | ✅ (`54` новых файлов) | ✅ (залито) |
| Knit Profi | 31 | ✅ (загружено 117 фото для 31 описаний) | ✅ чисто (0 дублей) | ✅ (`117` новых файлов) | ✅ (залито) |
| Анна Сутурина | 31 | ✅ (загружено 119 фото для 31 описаний) | ✅ чисто (0 дублей) | ✅ (`119` новых файлов) | ✅ (залито) |
| Бабушка Каро / Каролина | 31 | ✅ (загружено 83 фото для 31 описаний) | ✅ чисто (0 дублей) | ✅ (`83` новых файлов) | ✅ (залито) |
| Voobrazhalkina | 30 | ✅ (загружено 120 фото для 30 описаний) | ✅ чисто (0 дублей) | ✅ (`120` новых файлов) | ✅ (залито) |
| Евгения Шахова | 29 | ✅ (загружено 109 фото для 29 описаний) | ✅ чисто (0 дублей) | ✅ (`109` новых файлов) | ✅ (залито) |
| Hollywool | 125 | ✅ (загружено 450 фото для 125 описаний; 1 паттерн уже был с 5 фото до прогона — попал в аудит шага 6, откачен и переделан из-за дубля, теперь чисто) | ✅ чисто (0 дублей из 151, аудит по обоим авторам сразу с Екатериной Воробьевой) | ✅ (`450` новых файлов) | ⏳ ожидает выполнения пользователем |
| Екатерина Воробьева | 26 | ✅ (загружено 100 фото для 25 описаний — **переделано заново**: старая запись "0 фото/залито" была ДО фиксов `_generic_extract_gallery`/hooks.py в этой сессии, механизм теперь работает, Vigbo CDN другой поддомен `shop-cdn1-2.vigbo.tech`) | ✅ чисто (0 дублей) | ✅ (`100` новых файлов) | ⏳ ожидает выполнения пользователем (старые "залито"-команды с 0 фото — не использовать, устарели) |
| Елена Flight knit eat repeat | 38 | ✅ (загружено 146 фото для 38 описаний) | ✅ чисто (0 дублей) | ✅ (`146` новых файлов) | ⏳ ожидает выполнения пользователем |
| Efgesha_knits | 37 | ✅ (загружено 118 фото для 37 описаний) | ✅ чисто (0 дублей) | ✅ (`118` новых файлов) | ⏳ ожидает выполнения пользователем |
| Анастасия Алексейчик | 37 | ✅ (загружено 112 фото для 34 описаний) | ✅ чисто (0 дублей) | ✅ (`112` новых файлов) | ⏳ ожидает выполнения пользователем |
| Алена Шестопалова | 36 | ✅ (загружено 141 фото для 36 описаний) | ✅ чисто (0 дублей) | ✅ (`141` новых файлов) | ⏳ ожидает выполнения пользователем |
| Алена Бартенева | 35 | ✅ (загружено 140 фото для 35 описаний) | ✅ чисто (0 дублей) | ✅ (`140` новых файлов) | ⏳ ожидает выполнения пользователем |
| Анастасия Романова | 56 | ✅ (загружено 211 фото для 56 описаний) | ✅ чисто (0 дублей) | ✅ (`211` новых файлов) | ⏳ ожидает выполнения пользователем |
| Екатерина Кутушова | 54 | ✅ (загружено 212 фото для 53 описаний) | ✅ чисто (0 дублей) | ✅ (`212` новых файлов) | ⏳ ожидает выполнения пользователем |
| Pankova Nonna | 41 | ✅ (загружено 81 фото для 39 описаний) | ✅ чисто (0 дублей) | ✅ (`81` новых файлов) | ⏳ ожидает выполнения пользователем |
| Nadin Osipova | 68 | ✅ (загружено 256 фото для 65 описаний) | ✅ чисто (0 дублей) | ✅ (`256` новых файлов) | ⏳ ожидает выполнения пользователем |
| Екатерина Тригуб | 62 | ✅ (загружено 203 фото для 62 описаний) | ✅ чисто (0 дублей) | ✅ (`203` новых файлов) | ⏳ ожидает выполнения пользователем |
| Елена Коледова | 73 | ✅ (загружено 252 фото для 72 описаний) | ✅ чисто (0 дублей) | ✅ (`252` новых файлов) | ⏳ ожидает выполнения пользователем |
| Annetta-handmade | 80 | ✅ (загружено 176 фото для 76 описаний) | ✅ чисто (0 дублей) | ✅ (`176` новых файлов) | ⏳ ожидает выполнения пользователем |
| Анна Боробенкова | 82 | ✅ (загружено 317 фото для 81 описаний) | ✅ чисто (0 дублей) | ✅ (`317` новых файлов) | ⏳ ожидает выполнения пользователем |
| Анастасия Чебанина | 102 | ✅ (загружено 344 фото для 99 описаний) | ✅ чисто (0 дублей) | ✅ (`344` новых файлов) | ⏳ ожидает выполнения пользователем |
| Елена Грабенко | 108 | ✅ (загружено 328 фото для 90 описаний) | ✅ чисто (0 дублей) | ✅ (`328` новых файлов) | ⏳ ожидает выполнения пользователем |
| Виктория Морозова | 23 | ✅ (загружено 80 фото для 23 описаний) | ✅ чисто (0 дублей) | ✅ (`80` новых файлов) | ⏳ ожидает выполнения пользователем |
| Юлия Устинова (iiaks.ru) | 47 | ✅ (46×5 фото, 1×3 фото — меньше уникальных в галерее) | ✅ чисто (0 дублей из 98 паттернов, аудит по обоим авторам сразу) | ✅ (`186` новых файлов) | ⏳ ожидает выполнения пользователем |
| Юлия Старикова (staryxo-knit.com) | 51 | ✅ (51×5 фото) | ✅ чисто | ✅ (`204` новых файла) | ⏳ ожидает выполнения пользователем |
| Юлия Рубленова / viajeuvie | 71 | ✅ (загружено 239 фото для 65 описаний) | ✅ чисто (0 дублей) | ✅ (`239` новых файлов) | ⏳ ожидает выполнения пользователем |
| Юлия Вяжет | 2 | ✅ (0 фото, Tilda Zero Block/telegram) | ✅ чисто | ✅ (`0` файлов) | ⏳ ожидает выполнения пользователем |
| Юлия Егорова Juli Egorova | 32 | ✅ (загружено 127 фото для 32 описаний) | ✅ чисто (0 дублей) | ✅ (`127` новых файлов) | ⏳ ожидает выполнения пользователем |
| Юлия Кузнецова | 6 | ✅ (загружено 19 фото для 6 описаний) | ✅ чисто (0 дублей) | ✅ (`19` новых файлов) | ⏳ ожидает выполнения пользователем |
| Эля knitsometimes | 9 | ✅ (загружено 2 фото для 9 описаний) | ✅ чисто (0 дублей) | ✅ (`2` новых файла) | ⏳ ожидает выполнения пользователем |
| Татьяна Хупавка | 23 | ✅ (загружено 49 фото для 23 описаний) | ✅ чисто (0 дублей) | ✅ (`49` новых файлов) | ⏳ ожидает выполнения пользователем |
| Татьяна Foxknit | 0 | ✅ (0 фото, нет паттернов) | ✅ чисто | ✅ (`0` файлов) | ⏳ ожидает выполнения пользователем |
| Светлая | 2 | ✅ (загружено 8 фото для 2 описаний) | ✅ чисто (0 дублей) | ✅ (`8` новых файлов) | ⏳ ожидает выполнения пользователем |
| Светлана Кочкина | 60 | ✅ (загружено 236 фото для 60 описаний) | ✅ чисто (0 дублей) | ✅ (`236` новых файлов) | ⏳ ожидает выполнения пользователем |
| Светлана Голуб | 35 | ✅ (загружено 132 фото для 35 описаний) | ✅ чисто (0 дублей) | ✅ (`132` новых файлов) | ⏳ ожидает выполнения пользователем |
| Сабина Гюльмагомедова / С морем внутри | 31 | ✅ (загружено 124 фото для 31 описания) | ✅ чисто (0 дублей) | ✅ (`124` новых файлов) | ⏳ ожидает выполнения пользователем |
| Полина Кудрявцева | 5 | ✅ (загружено 13 фото для 5 описаний, Tilda JS) | ✅ чисто (0 дублей) | ✅ (`13` файлов) | ⏳ ожидает выполнения пользователем |
| Полина knit happens | 5 | ✅ (загружено 20 фото для 5 описаний, Tilda Store API) | ✅ чисто (0 дублей) | ✅ (`20` файлов) | ⏳ ожидает выполнения пользователем |
| Оля Вязательные истории | 4 | ✅ (загружено 3 фото для 4 описаний) | ✅ чисто (0 дублей) | ✅ (`3` новых файла) | ⏳ ожидает выполнения пользователем |
| Ольга Гришина | 47 | ✅ (загружено 184 фото для 46 описаний, Bitrix) | ✅ чисто (0 дублей) | ✅ (`184` файла) | ⏳ ожидает выполнения пользователем |
| О.Вискоза | 26 | ✅ (загружено 51 фото для 26 описаний) | ✅ чисто (0 дублей) | ✅ (`51` новых файлов) | ✅ завершено |
| Люба Цветное вязание | 7 | ✅ (7 из 7, 0 дублей) | ✅ | ✅ | ✅ завершено |
| Лилия Коробейникова | 51 | ✅ (50 из 51, 0 дублей) | ✅ | ✅ | ✅ завершено |
| Лика Королькова @likavyazhi | 6 | ⏳ (0 из 6 — Tilda Store API / JSON-only) | ✅ | ✅ | ✅ завершено |
| Лиза wweyklife | 9 | ⏳ (0 из 9 — требуется site-specific) | ✅ | ✅ | ✅ завершено |
| Лена Котикова | 26 | ✅ (14 из 26 — частично Tilda Store API) | ✅ | ✅ | ✅ завершено |
| Лана Бакаева | 17 | ✅ (17 из 17, 0 дублей) | ✅ | ✅ | ✅ завершено |
| Лавкабулавка Lavkabulavka | 50 | ✅ (46 из 50, 0 дублей) | ✅ | ✅ | ✅ завершено |
| Ксения Павленко | 75 | ✅ (75 из 75, 0 дублей) | ✅ | ✅ | ✅ завершено |
| Ксения Маликова | 143 | ⏳ (23 из 143 — требуется доработка скрапера) | ✅ | ✅ | ✅ завершено |
| Кристина Тарун | 31 | ✅ (30 из 31, 0 дублей) | ✅ | ✅ | ✅ завершено |
| Книстика вяжет | 10 | ✅ (9 из 10, 0 дублей) | ✅ | ✅ | ✅ завершено |
| Катя Фрог | 10 | ⏳ (0 из 10 — требуется site-specific) | ✅ | ✅ | ✅ завершено |
| Катрин Ралли / Katrin Ralli | 5 | ✅ (5 из 5, 0 дублей) | ✅ | ✅ | ✅ завершено |
| Катерина Родимова | 53 | ✅ (47 из 53, 0 дублей) | ✅ | ✅ | ✅ завершено |
| Карина Шахрай | 13 | ✅ (13 из 13, 0 дублей) | ✅ | ✅ | ✅ завершено |

**Важно:** оба автора **уже прошли полный цикл включая исправление
дедуп-бага** (первая версия на SHA-256 была сброшена и переделана заново с
нуля — см. раздел про dHash выше). Прод-команды, которые могли быть отданы
пользователю ДО этого исправления, устарели и не должны использоваться —
актуальные артефакты лежат в scratch-папках, сгенерированных ПОСЛЕ фикса
(`ustinova_prod/`, `starikova_prod/` в scratchpad сессии, где это
писалось — если модель продолжает в новой сессии, эти пути невалидны,
нужно перегенерировать через шаг 8 заново).

Следующий автор — по указанию пользователя.
