# Чек-лист парсинга авторов: цена, скидка, подробности

Идём по одному автору за раз. Ты заходишь на сайт автора в DevTools, находишь
теги/классы, где лежат цена, старая цена (скидка) и полное описание —
присылаешь мне. Я готовлю точечный обработчик под этот сайт в
`author_sync.py`, проверяю вживую (реальные HTTP-запросы, не только
компиляция), и отмечаю автора здесь.

Полное описание процесса — [DETAILS_PRICE_PARSING_PROCESS.md](DETAILS_PRICE_PARSING_PROCESS.md).
Технические детали парсинга по каждому автору — [author_parsing_notes.md](author_parsing_notes.md).
SQL-патч для переноса данных на прод — [generate_prod_backfill_sql.py](generate_prod_backfill_sql.py) → [prod_details_price_backfill.sql](prod_details_price_backfill.sql).

**Отмечаю `[x]`, когда для автора подтверждены цена + скидка + подробности**
(или явно решено, что часть недоступна — см. заметку). Частичный прогресс
(например, только подробности уже работали раньше) не считается готовым —
галочка ставится по итогу текущего раунда работы над ценой/скидкой.

## Статус на старте (2026-08-09)

- **Подробности** — колонка "Ранее" отражает результат последнего полного
  прогона `--sample-details` (см. `sample_details.md`): ✅ подтверждено
  вживую на 1-2 товарах, ❌ подтверждено НЕ работает (нужно смотреть отдельно),
  "?" — платформа предположительно та же, что у соседних eiwi.ru-авторов, но
  лично не проверялось, "—" не проверялось совсем.
- **Цена/скидка** — реализовано для WooCommerce (см. Annetta-handmade) и для
  всей `js-description`-платформы (см. Efgesha_knits) — вместе это уже ~41
  автор. Для остальных платформ ещё не парсится.

## Известные платформы (для контекста, не нужно присылать теги повторно)

- **Tilda Store (API)** — kitirrr.ru, tsinbal.ru, knithappens.ru,
  lavkabulavka.com, foxknit.ru, lenakotikova.ru — уже зарегистрированы в
  `SITE_HANDLERS`/`SUPPLEMENTAL_STORE_HANDLERS`, текст идёт через API
  (`p['text']`). Цена/скидка теперь тоже читается из этого же API (поля
  `price`/`priceold`, всегда были в ответе, просто не читались) — см.
  Екатерину Кутушову.
- **Tilda Store (hashroute)** — bysergeeva.ru, likavyazhi.ru — тот же Tilda
  Store, но без JSON API: сервер рендерит все товары статикой в
  `t754__product-full`-контейнерах, скрытых через CSS. Цена — `.t754__price`
  (текущая) / `.t754__price_old` (старая) внутри того же контейнера — см.
  Екатерину Сергееву.
- **js-description** — общий конструктор, `<article class="description
  js-description">`, используется огромным числом авторов ниже. Цена/скидка
  теперь тоже парсится общим механизмом (`.product-price-min` /
  `.product-price-old` / `.product-price-discount`, см. Efgesha_knits).
- **eiwi.ru** (DLE) — общий поддомен-магазин `eiwi.ru/<slug>`, подробности —
  через `#opisanieFS` (**2026-08-27: был `.textDesk`, и это была ошибка** —
  `.textDesk` тянул в описание заголовок «Описание», уведомление «Нажимая
  "Купить"…» и весь виджет «Рекомендуем также» со всеми остальными товарами
  автора: 8926 символов вместо 599. Затронуло все 9 авторов платформы,
  описания перебэкфилены — см. заметки), цена — через `#priceFull`/`#oldpriceFull`
  (`_extract_eiwi_price`). Механизм подтверждён на всех 9 авторах этой
  платформы (Анна Демидова, Книстика вяжет, Sash Koff, Бабушка Каро, Алла
  Безгодова, Анжелика Белика, Инесса, Оля Вязательные истории, Эля
  knitsometimes). У последних 5 локальная БД была устаревшей (`Author.site`
  указывал на t.me/vk.com, паттерны — на t.me вместо eiwi.ru) — сверили с
  продом (там уже были правильные ссылки, прод read-only через
  `ssh app@5.129.246.160`) и обновили `Author.site`+`Pattern.url` у 15
  паттернов в локальной БД по id. На проде на момент сверки 7 паттернов
  этих авторов ещё отсутствуют в локальной БД совсем (не создавались) —
  это отдельная задача импорта новых паттернов, не затрагивалась.
- **WooCommerce** — `.woocommerce-product-details__short-description`.
- **Generic Tilda** (tproduct/hash-route, не через SITE_HANDLERS) — изоляция
  контейнера уже работает через общий `js-product|t-item|t-popup` regex.

---

## Авторы

- [ ] Carrie — https://www.youtube.com/@carrie.create — YouTube, не сайт, пропустить?
- [ ] love-to-knit.com — https://love-to-knit.com/ — не проверено (сэмпл попал на t.me-ссылку конкретного товара)
- [ ] maria_m_knits Вязаные штучки — https://www.youtube.com/@... — YouTube, не сайт, пропустить?
- [ ] Vika Koss — https://www.youtube.com/@VIKTORIA_KOSS — YouTube, не сайт, пропустить?
- [ ] Анна Иноземцева — https://inoz.studio — Tilda, но и цена (`.t762__price-value.js-product-price`), и подробности (`.t762__descr`) рендерятся ТОЛЬКО через JS (popup по клику на "Купить") — подтверждено: 0 совпадений с `.tn-atom`/`t762`/`store.tildaapi.com`/любым `₽`/`руб` в сыром HTML любой из 5 её страниц, обычный GET+BeautifulSoup принципиально не видит эту разметку. Пользователь прислал реальные теги из DevTools для 1 товара (МК тапочки «Балетки» = 990₽, без скидки, + текст подробностей) — внесено вручную напрямую в БД (не через `--backfill-details`, автоматики тут нет). НЕ добавлена в `CONFIRMED_AUTHORS` — ежедневный `check_price_updates.py` не смог бы ничего найти и обнулил бы цену. Остальные 4 товара нужно так же вручную прислать из DevTools, если нужно их заполнить.
- [ ] Люда Беляева, LeLu — https://t.me/LeLu_vesna — Telegram, не сайт (2 паттерна в БД, оба на t.me) — пропустить? Новый автор, найден при сверке с продом (её не было в локальной БД совсем).
- [ ] Несерьезное вязание — https://flufffstufff.ru/ — Taplink, текста на сайте нет в принципе (всё картинками) — решили не парсить, см. переписку
- [ ] Регина Всё по узору — https://www.youtube.com/@... — YouTube, не сайт, пропустить?
- [ ] Татьяна Foxknit — https://foxknit.ru/ — Tilda Store API (SITE_HANDLERS), не сэмплировано (0 паттернов на момент прогона) — механизм цены уже готов (тот же, что у Екатерины Кутушовой), сработает автоматически как только появятся паттерны; не отмечаю [x] — не на чем проверить
- [x] Anastasiia Stupa — https://anastasiiastupa.ru — **InSales** (новая платформа в списке), подробности: ✅ (`.product-description` — добавлен последним фолбэк-селектором; свой класс шаблона `product-description wysiwyg`), цена: ✅ — общий механизм `_extract_insales_price` (`.product-price-container` + `.js-product-price`), не хук под автора: разметка ядра InSales (`money__amount`/`money__currency`/`data-product-price`), заработает у любого следующего автора на этой платформе. **Главное про эту платформу: цифры цены рендерит JS, в серверном HTML span ПУСТ** — единственный источник числа это атрибут `data-product-price`, разбор видимого текста (как во всех остальных механизмах цепочки) вернул бы None на каждом товаре. Так же и `style="display: none"` у `<strike>` старой цены: в DevTools он есть, в серверном ответе его нет вовсе — от фантомной скидки защищает не он, а пустое значение + условие `oldPrice > price`. Проверено живьём на всех 6 товарах сайта: на каждой странице ровно по одному `.product-price-container` и `.product-description`, цены 1100/1100/1450/1450/1450/1700, подробности 328–964 симв. **Скидка живьём НЕ подтверждена** — сейчас её нет ни у одного товара; ветка старой цены проверена только на синтетической разметке. Своих `DOMAIN_CRAWL_HOOKS` не потребовалось. Автора нет в локальной БД — бэкфилл локально не собрать, `generate_prod_backfill_sql.py` пропустит её с предупреждением (как 16 авторов от 2026-08-23).
- [x] Ксения Маликова — https://kseniyamalikova.ru/shop — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм сработал без правок — подтвердил пользователь как "уже должно работать"). Этого автора не было в локальной БД совсем — импортирован read-only копированием с прода (17 паттернов).
- [x] Люба Цветное вязание — https://tsvetnoeviazanie.ru — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм, без правок). Этого автора не было в локальной БД совсем — импортирован с прода (7 паттернов); 1 паттерн ("Митенки «Гусиные лапки»") без цены — он `isFree=true` на проде, это ожидаемо.
- [x] Наталья Брагина nata_foksy — https://natafoksy.ru/shop — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм, без правок). Найдено расхождение при импорте: в локальной БД автор с этим же id уже существовал, но под именем "nata_foksy" (без "Наталья Брагина"), а не "Наталья Брагина nata_foksy" как на проде и в чек-листе — из-за этого `--backfill-details "Наталья Брагина nata_foksy"` находил 0 совпадений по имени. Переименовал автора в БД под прод-имя, доимпортировал недостающие 26 паттернов с прода (3 уже были). 28/29 с ценой (1 — t.me-ссылка, вне скоупа).
- [x] Юлия Кузнецова — https://byjuliakuznetsova.ru/shop — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм, без правок). Этого автора не было в локальной БД совсем — импортирован с прода (6 паттернов); 2 без цены — оба `isFree=true` на проде.
- [x] Анна Сутурина — https://annasuturina.ru/shop/ — WooCommerce Blocks (Interactivity API тема), подробности: ✅ (`#tab-description` — на этой теме нет `.woocommerce-product-details__short-description` вообще, добавлен новый фолбэк-селектор в конец списка), цена+скидка: ✅ — почти сработал общий WooCommerce-механизм, но потребовалась правка: `_extract_woocommerce_price` брал ПЕРВЫЙ найденный `.price`, а на этой теме перед настоящей ценой на странице стоят пустые JS-гидратируемые `.price`-плейсхолдеры (`<ins data-wp-text="state.itemPrice">` без текста) — переписал на перебор ВСЕХ кандидатов + добавил `.wc-block-components-product-price` в селектор (у реального блока цены нет голого класса `.price`). Проверено на 3 уже работающих WooCommerce-авторах (Annetta-handmade и др.) — регрессии нет. Ни у одного паттерна скидки не было. Этого автора не было в локальной БД совсем (0 Author, 0 Pattern) — импортирован read-only копированием с прода (9 паттернов).
- [x] Елена Янсон — https://elena-ianson.ru/shop — js-description, подробности: ✅ (общий механизм, но контейнер `.text.f__2` тут БЕЗ `<p>`-тегов вообще — расширил `_extract_details_text`, чтобы `exclude_paragraph`-фильтр работал и по строкам `<br>`-разделённого текста, не только по `<p>`; добавлен `_elena_ianson_exclude_details_paragraph` для исключения повторяющегося блока про доставку/папку "Спам"), цена+скидка: ✅ (общий механизм `.product-price-min`/`.product-price-discount` — см. Efgesha_knits; найдено 6 реальных скидок). Этого автора не было в локальной БД совсем — импортирован read-only копированием с прода (9 паттернов).
- [x] Катрин Ралли / Katrin Ralli — https://katrinralli.com/ — js-description, подробности: ✅ (общий механизм сработал без правок — присланный пользователем боилерплейт про "Комментарий по расходу пряжи" на её реальных 4 паттернах в БД не встретился, видимо относился к странице, которой нет в локальной БД), цена+скидка: ✅ (общий механизм, скидок не найдено). Этого автора не было в локальной БД совсем — импортирован read-only копированием с прода (4 паттерна).
- [x] Алла Безгодова — https://eiwi.ru/allabezgodova — eiwi.ru, подробности: ✅, цена+скидка: ✅ (общий eiwi.ru-механизм — см. заметку у Анны Демидовой). `Author.site`/`Pattern.url` были устаревшими (t.me вместо eiwi.ru) — сверены и обновлены в локальной БД по данным прода (там уже правильные). 2 из 6 паттернов в БД реально на eiwi.ru (bell_hat, ceylon_bag), остальные 4 — t.me/YouTube, вне скоупа.
- [x] Анжелика Белика — https://eiwi.ru/beleeka — eiwi.ru, подробности: ✅, цена+скидка: ✅ (общий eiwi.ru-механизм). `Author.site`/`Pattern.url` обновлены по данным прода, как у Аллы Безгодовой. Все 7 паттернов в БД реально на eiwi.ru — полностью забэкфилена.
- [x] Инесса — https://eiwi.ru/knitinessa — eiwi.ru, подробности: ✅, цена+скидка: ✅ (общий eiwi.ru-механизм). `Author.site`/`Pattern.url` обновлены по данным прода. Оба паттерна в БД реально на eiwi.ru — полностью забэкфилена. На проде есть ещё 1 паттерн (Scandic Hat), которого нет в локальной БД — не импортировался, отдельная задача.
- [x] Оля Вязательные истории — https://eiwi.ru/olsu — eiwi.ru, подробности: ✅, цена+скидка: ✅ (общий eiwi.ru-механизм, найдена реальная скидка у "Ариэль" 800/1000₽). `Author.site`/`Pattern.url` обновлены по данным прода. 3 из 4 паттернов в БД на eiwi.ru, четвёртый — YouTube, вне скоупа.
- [x] Эля knitsometimes — https://eiwi.ru/knitsometimes — eiwi.ru, подробности: ✅, цена+скидка: ✅ (общий eiwi.ru-механизм). `Author.site`/`Pattern.url` обновлены по данным прода. 1 из 4 паттернов в БД на eiwi.ru (rustic_cardigan), остальные 3 — t.me, вне скоупа. На проде есть ещё 5 паттернов этого автора на eiwi.ru, которых нет в локальной БД (включая дублирующий по названию "#imperfect_sweater" с другим id/slug) — не импортировались, отдельная задача.
- [x] Ольга Гришина — https://omalica.ru — Bitrix, подробности: ✅ (`.preview-desc[itemprop="description"]`, рендерится статически несмотря на то, что цена — нет), цена+скидка: ✅ частично — свой хук `_extract_omalica_price` читает schema.org-микроразметку (`.cart-info-block [itemprop="price"]`), т.к. видимые `.price`/`.old-price` div'ы пустые в обычном GET (заполняются JS из AJAX-строки). Старая цена (скидка) недоступна тем же способом — своей микроразметки для неё нет, оставлена пустой. 46/47 паттернов забэкфилены (1 — "Джемпер «Колосок»" — 404 на сайте, битая ссылка в БД, не связано с парсингом).
- [x] Катя Фрог — https://ekaterinafrog.ru/knit — Tilda Zero Block, подробности: ❌ (решено оставить пустым — на странице только FAQ-блоки, полного описания товара нет), цена+скидка: ✅ (свой хук `_extract_frog_price`: цена — голый текст типа "990р." в `.tn-atom`, без своего price-класса; привязка к стабильному `field="tn_text_1770370854473000002"`, а не к текстовой форме — иначе можно случайно поймать "NN р." = "NN рядов" в описании вязания). Скидок не найдено. 10/10 паттернов забэкфилены.
- [x] Юлия Вяжет — https://juliavyazget.com/ — Tilda Zero Block, подробности: ❌ (решено оставить пустым, как и у Кати Фрог), цена+скидка: ✅ (свой хук `_extract_julia_vyazget_price`, тот же паттерн, что у Кати Фрог — голый текст "790 рублей" в `.t1115__feature-descr`, привязка к стабильному `field="li_descr__2828366988192"`). Скидок не найдено. 1/2 паттернов на её собственном домене забэкфилен ("Гусь" — 790₽); второй паттерн — t.me-ссылка, уже `isFree=true`, вне скоупа.
- [x] Евгения Шахова — https://shakhova-mk.com/shop/vse — платформа опознана как WooCommerce (по факту, механизм сработал без правок), подробности: ✅, цена+скидка: ✅ (найдена реальная скидка 450/750₽). `Author.site` в БД указывает на vk.com, но непустых паттернов на её собственном домене 17/17.
- [x] Настя Блошный рынок — https://anb-hook.ru/ — generic Tilda (tproduct, изоляция через общий `js-product|t-item|t-popup` regex), подробности: ✅, цена+скидка: ✅ (сработал общий механизм `.js-product-price` без правок). Только 1 из 4 паттернов в БД на её собственном домене — остальные 3 ведут на YouTube, не в скоупе бэкфилла.
- [x] Полина Кудрявцева — https://www.privetpolinka.com/shop — generic Tilda (tproduct), подробности: ✅, цена+скидка: ✅ (общий механизм `.js-product-price` без правок). Попутно найден и починен баг: `backfill_details()`/`sample_details()`/`_get_crawl_hooks` падали с `TypeError`, если `Author.site` в БД пустой (`NULL`) — у неё именно так.
- [x] Светлая — https://svetlayasveta.ru/ — generic Tilda (tproduct), подробности: ✅, цена+скидка: ✅ (общий механизм `.js-product-price` без правок). `Author.site` тоже был пустым — см. заметку у Полины Кудрявцевой про починенный баг.
- [x] Sash Koff — https://eiwi.ru/sashkoff — eiwi.ru, подробности: ✅, цена+скидка: ✅ (общий eiwi.ru-механизм — см. заметку у Анны Демидовой). Все 7 её паттернов в БД реально ведут на eiwi.ru (в отличие от большинства других eiwi.ru-авторов чек-листа) — полностью забэкфиллена.
- [x] Бабушка Каро / Каролина — https://eiwi.ru/Babushka_karo — eiwi.ru, подробности: ✅, цена+скидка: ✅ (общий eiwi.ru-механизм). Из 2 паттернов в БД только 1 реально ведёт на eiwi.ru (второй — битая ссылка на t.me) — забэкфилен тот, что можно.
- [x] Катерина Родимова — https://katerinarodimova.com — WooCommerce, подробности: ✅, цена+скидка: ✅ (общий WooCommerce-механизм — уже проверялся вживую ещё во время работы над Annetta-handmade).
- [x] Алена Халявина — https://loonymax.tilda.ws — Tilda hash-route (SUPPLEMENTAL_STORE_HANDLERS, зарегистрирован новый экземпляр `scrape_loonymax_store`), подробности: ✅, цена+скидка: ✅ (та же схема `.t754__price`, что у Екатерины Сергеевой/bysergeeva.ru). Дополнительно исключены повторяющиеся ссылки "→ ПОЛУЧИТЬ ДОСТУП" (`a[href*="payform.ru"]`) через новый параметр `extra_decompose_selectors` фабрики `_make_tilda_hashroute_store_handler`. Найдено даже больше товаров (10), чем через обычный краулер (8).
- [x] Анастасия Соломатова — https://knittingsamurai.ru/catalogue/ — WooCommerce, подробности: ✅ (найдены сами, через уже существующий `.woocommerce-product-details__short-description` — работают на 24 из 27), цена+скидка: ✅ (общий WooCommerce-механизм, без доп. работы; попутно нашли и починили баг в `_parse_woo_price` — см. запись в примечаниях). ВАЖНО: бэкфиллены только уже существующие описания, новый скан новинок не запускался.
- [x] Анна Боробенкова — https://annaboronbekova.ru — свой хук (opisania), подробности: ✅, цена+скидка: ✅ (общий WooCommerce-механизм сработал без доп. кода — сайт оказался на WooCommerce).
- [x] Виктория Морозова — https://viktoria-morozova.ru/shop — Tilda hash-route (SUPPLEMENTAL_STORE_HANDLERS, зарегистрирован новый экземпляр `scrape_viktoria_morozova_store`), подробности: ✅, цена+скидка: ✅ (та же схема `.t754__price`, что у Екатерины Сергеевой/Алёны Халявиной). 26 товаров на одной hash-route странице.
- [x] Екатерина Воробьева — https://thiscosynest.com — платформа: Tilda "js-product-price" popup-семейство, подробности: ✅, цена+скидка: ✅ (`_extract_tilda_store_popup_price`, общий механизм — см. заметку у Елены Flight).
- [x] Елена Flight knit eat repeat — https://knitmode.ru/patterns — Tilda (DISCOVERY_HANDLERS + generic per-page fetch), подробности: ✅, цена+скидка: ✅ — новый ОБЩИЙ механизм `_extract_tilda_store_popup_price` в hooks.py: `.js-product-price` — Tilda-внутренний класс-маркер "это текущая цена", общий для нескольких блоков Tilda (`t744`, `t780`/Cards и т.д.), поэтому не завязан на конкретный номер блока. Старая цена — `[class*="price-old-val"]`. Заодно почистил шум (цена+кнопка "Купить"/"в корзину") из "Подробности" — переставил извлечение цены ДО вычисления текста в `fetch_and_parse_detail`, чтобы можно было безопасно `decompose()` найденный блок цены/кнопку (`[class*="price-wrapper"], .t-btn`) перед чтением текста страницы. Тот же механизм сразу заработал на elzestores.ru, bayuma.ru, helenyakovleva.com, thiscosynest.com.
- [x] Елена Яковлева — https://www.helenyakovleva.com — Tilda (свой хук для картинки, Cards-блок t784), подробности: ✅, цена+скидка: ✅ (общий механизм `.js-product-price` — см. заметку у Елены Flight; на этом блоке скидка не встречалась, только текущая цена).
- [x] Лиза wweyklife — https://elzestores.ru — generic Tilda, подробности: ✅, цена+скидка: ✅ (общий механизм `.js-product-price` — см. заметку у Елены Flight).
- [x] Мария Баюкина — https://bayuma.ru — generic Tilda, подробности: ✅, цена+скидка: ✅ (общий механизм `.js-product-price` — см. заметку у Елены Flight).
- [x] Анастасия Романова — https://romnastena.com — свой хук (`.product__text`), подробности: ✅, цена+скидка: ✅ — `_extract_romnastena_price` в hooks.py: `.product__price` (голое число + соседний `<span class="icon icon-rur">` без текста). Скидок не нашёл на 10 живых товарах — пока только текущая цена, как у Hollywool.
- [x] Екатерина Кутушова — https://kitirrr.ru/shop — Tilda Store API, подробности: ✅, цена+скидка: ✅ — ОБЩИЙ механизм для всей группы Tilda Store (`_parse_tilda_store_api_price` в handlers.py): API `store.tildaapi.com` уже отдаёт поля `price`/`priceold` (просто не читались) — `price` в формате `"700.0000"` (точка), `priceold` в формате `"1490,00"` (запятая — здесь это десятичный разделитель, не разделитель тысяч!) или `''` при отсутствии скидки. Подробности — см. `author_parsing_notes.md`.
- [x] Екатерина Сергеева Девочка с ниточками — https://bysergeeva.ru/ — Tilda hash-route (SITE_HANDLERS), подробности: ✅, цена+скидка: ✅ — второй механизм внутри той же группы Tilda Store: `.t754__price .t754__price-value` (текущая)/`.t754__price_old .t754__price-value` (старая, пустой текст при отсутствии скидки) внутри изолированного `t754__product-full`-контейнера. Заодно почистил "Подробности" — раньше туда утекали цена/"руб"/кнопка "Добавить в корзину" (аналогично уже исправленному для js-description).
- [x] Лавкабулавка Lavkabulavka — https://lavkabulavka.com — Tilda Store multi (SITE_HANDLERS), подробности: ✅ (кроме `/bk` — вне зарегистрированных секций, отдельный случай), цена+скидка: ✅ (общий Tilda Store API механизм — см. заметку у Екатерины Кутушовой; `/bk` при этом реально имеет цену 0 на сайте — не баг).
- [x] Лена Котикова — https://lenakotikova.ru — Tilda Store (SUPPLEMENTAL_STORE_HANDLERS), подробности: ✅, цена+скидка: ✅ (общий Tilda Store API механизм — см. заметку у Екатерины Кутушовой).
- [x] Лика Королькова @likavyazhi — https://likavyazhi.ru/shop — Tilda hash-route (SUPPLEMENTAL_STORE_HANDLERS, не SITE_HANDLERS — поправил заголовок), подробности: ✅, цена+скидка: ✅ (тот же hashroute-механизм, что у Екатерины Сергеевой). Заодно нашёл и починил баг: `sample_details()`/`backfill_details()` проверяли только `SITE_HANDLERS`, из-за чего этот автор шёл через обычный постраничный fetch вместо изолированного per-product хендлера. Большинство паттернов (4 из 5) — "осиротевшие" алиас-страницы вне текущего ответа Store API (уже задокументировано раньше), не баг.
- [x] Мария Цинбал — http://tsinbal.ru — Tilda Store API, подробности: ✅, цена+скидка: ✅ (общий Tilda Store API механизм — см. заметку у Екатерины Кутушовой; 2 реальные скидки найдены вживую, напр. 1290/1490₽).
- [x] Полина knit happens — https://knithappens.ru — Tilda Store API, подробности: ✅, цена+скидка: ✅ (общий Tilda Store API механизм — см. заметку у Екатерины Кутушовой).
- [x] Анна Демидова — https://eiwi.ru/anndemido — eiwi.ru, подробности: ✅, цена+скидка: ✅ (`_extract_eiwi_price` в hooks.py: `#priceFull`/`#oldpriceFull` по всей странице — `#oldpriceFull` рендерится с ПУСТЫМ текстом, когда скидки нет, не атрибутом `hidden` как у Hollywool). Подробности — см. `author_parsing_notes.md`.
- [x] Книстика вяжет — https://eiwi.ru/kvartanovahFU — eiwi.ru, подробности: ✅, цена+скидка: ✅ (общий eiwi.ru-механизм — см. заметку у Анны Демидовой).
- [x] Annetta-handmade — https://annetta-handmade.ru — WooCommerce, подробности: ✅, цена+скидка: ✅ (готово, проверено на 3 товарах + 18 со скидкой найдено вживую). По ходу исключил 3 фразы-бойлерплейт из "Подробностей" (доставка на почту / форма на сайте / копирайт) — специфично для этого автора. Цена/скидка реализованы ОБЩИМ WooCommerce-механизмом (`.woocommerce-Price-amount`, `<ins>`/`<del>`) — уже проверил, что работает и на katerinarodimova.com, должно сработать и на Анастасии Соломатовой без доп. работы.
- [x] Efgesha_knits — https://efgesha.ru — js-description, подробности: ✅, цена+скидка: ✅ — новый ОБЩИЙ механизм для всей js-description платформы (`_extract_js_description_platform_price` в hooks.py): `.product-price-min` внутри `.description.js-description` — обычная цена; при активной скидке та же цена дополнительно несёт класс `.product-price-old`, а рядом появляется `.product-price-discount` с актуальной ценой. Заодно сузил контейнер "Подробности" с `.description.js-description` до вложенного `.description.js-description .text.f__2` — раньше в текст утекали цена/кнопка "КУПИТЬ"/"В наличии: N шт.", теперь текст чистый. Проверено вживую на всех 40 авторах этой платформы через `--sample-details` (`sample_details.md`) — цена и скидка корректно извлеклись у всех, кроме страниц без цены вовсе или с уже известной битой `Pattern.url` (см. их собственные заметки ниже).
- [x] Hollywool — https://hollywool.ru/catalog/besplatnye-opisaniya/ — свой хук (Bitrix, `.hw-rich-description`), подробности: ✅, цена+скидка: ✅ (`.hw-lab-price`, `[data-hw-current-price]`/`[data-hw-old-price]`, скидка определяется по отсутствию атрибута `hidden`; активных скидок на бесплатные описания на сайте не нашли). Заодно расширил `_extract_details_text` на `<li>`/`<tr>` — раньше списки навыков/пряжи и таблица размеров молча терялись (собирались только `<p>`). Подробности — см. `author_parsing_notes.md`.
- [x] katyushaworkshop — https://katyushaworkshop.com/ — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Knit Profi — https://knitprofi.ru/shop — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Leya_koss — https://leya-koss.ru/ — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] LikeWool — https://likewool.shop/master-class/all — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Nadin Osipova — https://nadin-shop.com/ — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Pankova Nonna — https://pankovanonna.com — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Purple Deer Knits |Сиреневый олень вяжет — https://purple-deer-knits.ru — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Voobrazhalkina — https://voobrazhalkina.com/shop/crochet — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Алена Бартенева — https://alenabarteneva.ru — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Алена Шестопалова — https://alyonashe.com — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Анастасия Алексейчик — https://anastasiyaalekseichik.com/ — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Анастасия Пискунова — https://marini-sti.com/ — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Анастасия Чебанина — https://nastasiay.ru/ — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Белинская Лиза — https://lizabelinski.ru — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Вера Одинцова Vera knits — https://vera-knits.ru — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Дарья Малеева (Баруздина) — https://maleevaknits.ru — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Евгения Телегина — https://evgeniyatelegina.ru — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Екатерина Тригуб — https://katriv.com — подробности: ✅ (похоже на js-description) цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Елена Грабенко — https://elenagrabenko.com/shop — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Елена Коледова — https://koledovaelena.ru/shop — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Карина Шахрай — https://karinavyazhet.ru — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Кристина Тарун — https://christinatarun.ru — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Ксения Павленко — https://108loops.ru — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Лана Бакаева — https://lanabakaeva.ru — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Лилия Коробейникова — https://lily-knitting.com — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Маргарита Терехова — https://margaritaterekhova.ru — js-description, подробности: ✅ (у одного сэмпла был битый `Pattern.url` на `/shop` без слага — проблема данных, не парсинга), цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Мария Mary knitting — https://mary-knit.com/ — вероятно js-description, подробности: ✅ (та же история с битым `/shop`-URL на одном сэмпле), цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Маша Зябликова — https://mashapatterns.ru/ — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Милена Вяжет — https://milenavyazhet.ru — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Настя Надень шапку — https://mustardyarn.ru/shop/patterns — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Настя Петли и сплетни — https://petliispletni.ru/shop — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] О.Вискоза — https://oviscoza.ru/shop/ (+ viscozzi.ru) — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Сабина Гюльмагомедова / С морем внутри — https://s-morem-vnutri.ru/shop — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Светлана Голуб — https://sgknitting.ru — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Светлана Кочкина — https://crochet-together.com — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Татьяна Хупавка — https://hupavka-knit.ru — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Юлия Егорова Juli Egorova — https://juliegorova.com/Shop — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Юлия Рубленова / viajeuvie — https://viajeuvie.com/ — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Юлия Старикова — https://staryxo-knit.com — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).
- [x] Юлия Устинова — https://iiaks.ru — js-description, подробности: ✅, цена+скидка: ✅ (общий механизм для всей js-description платформы — см. заметку у Efgesha_knits).

---

## Отдельно — как поступить с не-сайтами?

YouTube (Carrie, maria_m_knits, Vika Koss, Регина Всё по узору) и Telegram/VK
(love-to-knit.com's отдельные товары, Люда Беляева/LeLu, Фиорафана — здесь
её сайта вообще нет в списке, только t.me — значит либо не заведена как
отдельный Author с site, либо потерялась при выгрузке) — цену/скидку/
подробности с них штатно не достать (нет HTML-страницы товара в привычном
виде). Стоит явно решить: пропускаем совсем, или для них нужен отдельный,
нестандартный подход (например, парсинг описания видео на YouTube)?
