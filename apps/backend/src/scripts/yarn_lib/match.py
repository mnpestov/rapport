# -*- coding: utf-8 -*-
"""Сопоставление упоминания пряжи из текста с карточкой справочника.

Правил восемь, и порядок между ними — не оформление, а логика: каждое
следующее слабее предыдущего, и сильное обязано отработать раньше. Два из
восьми связь НЕ создают, а откладывают упоминание на разбор человеку — там,
где точность правила измерена и оказалась низкой.

Точность (проверено на связях, где автор указал метраж, — §7 плана):
    точное            95%    создаёт связь
    частичное         89%    создаёт связь
    краткое написание  —     создаёт связь
    по семейству      94%    НЕ создаёт: карточка семейства склеит нити
                             разной толщины и сломает поиск
    по названию линейки 36%  НЕ создаёт: каждая третья связь была бы ложной
    уровень бренда    80%    создаёт связь, но при жёстком условии
    родовое название   —     создаёт связь, идёт последним
"""
import re

from .brands import ALIAS_RE, ALIAS_TO_BRAND, BRANDS, STOP_WORDS, TOKEN
from .corrections import CORRECTIONS
from .keys import norm_key

# Токены, отличающие соседние линейки одной марки. Без них нестрогие правила
# склеивают «Gazzal Baby Cotton» с «Gazzal Baby Cotton XL» — разные пряжи с
# разным метражом.
VARIANT = (
    'xl', 'xxl', 'fine', 'plus', 'big', 'maxi', 'mini', 'lux', 'tweed',
    'batik', 'degrade', 'ombre', 'print', 'color', 'extra', 'light', 'new',
    'baby', '800', '120', '130', '150', '400',
)

# Родовые названия без марки. Порядок важен: «эко-норка» проверяется первой,
# иначе её съест правило «пуха норки» — «норк» есть в обеих.
GENERIC_RULES = (
    ('Эко-норка', re.compile(r'\bэко[\s\-]?норк\w*|лебяж\w*\s+пух', re.I)),
    ('Пух норки', re.compile(
        r'(?<!эко)(?<!эко[\s-])пух[ао]?[\s\-]*норк\w*'
        r'|(?<!эко)(?<!эко[\s-])\bнорк[аиуе]\b'
        r'|\bнорочн\w*|\bmink\b', re.I)),
)

# Брендовая норка существует отдельно и должна выигрывать: «Color City Норка»
# и «YarnArt Mink» — настоящие карточки, и описанию, где марка названа явно,
# родовую приписывать нельзя.
BRANDED_GENERIC = re.compile(
    r'(color\s*city|colorcity|yarn\s*art|yarnart|astra\s*premium|астра\s*премиум'
    r'|artland|art\s*land)'
    r'\s*[«"\']?\s*(норк|norka|mink|пух\s*норки)', re.I)


# Слова, которые называют сырьё или свойство, а не пряжу. Линейка, целиком
# состоящая из них, кандидатом быть не может: «Пехорка Мериносовая» иначе
# ловится в «100% мериносовая шерсть», а «Камтекс Воздушная» — в «воздушная
# петля». Обе ошибки живьём и были.
FIBRE_WORD = re.compile(
    r'^(мерино\w*|шерст\w*|хлопк?о\w*|хлопок|л[ёе]н|льн\w*|ш[ёе]лк\w*|мохер\w*'
    r'|кашемир\w*|альпак\w*|ангор\w*|вискоз\w*|акрил\w*|нейлон\w*|полиамид\w*'
    r'|носочн\w*|летн\w*|зимн\w*|воздушн\w*|детск\w*|пухов\w*'
    r'|merino|wool|cotton|linen|silk|mohair|cashmere|alpaca|angora|viscose'
    r'|acrylic|nylon)$', re.I)

# «390 м/100 г» и «50 г/130 м» — обе записи встречаются вперемешку.
METRAGE_PAIR = re.compile(
    r'(\d{2,4})\s*м\w*\s*[/\\-]\s*(\d{2,3})\s*г'
    r'|(\d{2,3})\s*г\w*\s*[/\\-]\s*(\d{2,4})\s*м', re.I)


def _metrages(window):
    """Все метражи в окне, приведённые к метрам на 100 г."""
    out = []
    for g in METRAGE_PAIR.findall(window):
        if g[0]:
            m, w = int(g[0]), int(g[1])
        else:
            w, m = int(g[2]), int(g[3])
        if w:
            out.append(round(m * 100 / w))
    return out


def _edit_within(a, b, cap):
    """Расстояние Левенштейна не больше cap. Считаем с отсечением: полная
    матрица на 2800 ключей ради двух символов разницы не нужна."""
    if abs(len(a) - len(b)) > cap:
        return False
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        if min(cur) > cap:
            return False
        prev = cur
    return prev[-1] <= cap


class YarnIndex:
    """Справочник в памяти. 2209 карточек — грузится один раз за прогон."""

    def __init__(self, cards):
        """cards: список dict с id, name, normalized_key, brand, is_generic,
        m_per_100g и списком aliases (нормализованных)."""
        self.cards = cards
        self.by_key = {}
        for c in cards:
            self.by_key.setdefault(c['normalized_key'], c)
            for a in c.get('aliases') or []:
                self.by_key.setdefault(a, c)
        # Родовые обрабатываются последним правилом и только им.
        self.generic = {c['name']: c for c in cards if c['is_generic']}
        # Ключи имён марок — для правила «карточка названа полнее».
        self._brand_keys = {norm_key(b) for b in BRANDS}
        # Сверенные человеком исправления: ключ авторского написания -> та
        # карточка, которую он имел в виду. Держим ключами, а не строками,
        # чтобы регистр и знаки не мешали.
        self._corrections = {}
        for wrong, right in CORRECTIONS.items():
            card = self.by_key.get(norm_key(right))
            if card:
                self._corrections[norm_key(wrong)] = card

        # Марки, у которых выбор линейки не меняет метража, — только для них
        # допустима связь уровня бренда. Родовые карточки исключены: у них
        # brand совпадает с name, они выглядят монопродуктовой маркой и
        # перехватили бы все упоминания «пуха норки» раньше родового правила.
        by_brand = {}
        for c in cards:
            if c['is_generic'] or not c.get('brand'):
                continue
            by_brand.setdefault(norm_key(c['brand']), []).append(c)
        # Линейки, названные без марки: «Lanagold Fine – 390м/100гр».
        # Годятся только однозначные — те, что есть ровно у одной марки.
        # «Bella» это и Alize, и Lana Grossa; «Baby Wool» — Gazzal, Alize и
        # ещё один; такие пропускаем, выбирать за автора нельзя.
        lines = {}
        for c in cards:
            if c['is_generic'] or not c.get('brand') or c.get('m_per_100g') is None:
                continue
            line = c.get('line') or (
                c['name'][len(c['brand']):].strip()
                if c['name'].lower().startswith(c['brand'].lower()) else None)
            if not line:
                continue
            words = [w.strip('.,') for w in line.split()]
            if all(FIBRE_WORD.match(w) for w in words if w):
                continue
            k = norm_key(line)
            # Порог в восемь символов — тот же, что у частичного правила:
            # на коротком куске совпадение ничего не значит.
            if len(k) < 8:
                continue
            lines.setdefault(k, set()).add(c['name'])
            self._line_card = getattr(self, '_line_card', {})
            self._line_card[k] = c
        self.by_line = {k: self._line_card[k]
                        for k, names in lines.items() if len(names) == 1}

        self.brand_ok = {
            b: cs[0] for b, cs in by_brand.items()
            if len({c['m_per_100g'] for c in cs}) == 1 and cs[0]['m_per_100g'] is not None
        }

    def lookup(self, article):
        """Три сильных правила: точное -> частичное -> краткое написание."""
        k = norm_key(article)
        if not k:
            return None, None
        hit = self.by_key.get(k)
        if hit:
            return hit, 'EXACT'

        # Автор написал ДЛИННЕЕ известного: «Gazzal Baby Cotton 50 гр» при
        # карточке «Gazzal Baby Cotton». Порог в 10 символов отсекает
        # совпадения по коротким общим кускам вроде «wool».
        for kk, v in self.by_key.items():
            if len(kk) >= 10 and kk in k and kk != k:
                rest = k.replace(kk, '')
                if not any(x in rest for x in VARIANT):
                    return v, 'PARTIAL'

        # Автор написал КОРОЧЕ: «Seam Anna» при карточке «Seam Anna 16».
        # Хвост ограничен шестью символами — на большем это уже другая линейка.
        #
        # Но сперва проверка на семейство, и она обязана идти ДО выбора
        # кандидата. «Lana Grossa Meilenweit» — приставка к 79 карточкам с
        # четырьмя разными метражами; правило нашло бы среди них ту, что
        # короче на два символа («Meilenweit 50»), и выдало бы связь на
        # случайную линейку. То же с «Katia» и «Drops». Признак семейства —
        # несколько метражей среди ВСЕХ карточек с этой приставкой, а не
        # среди подходящих под порог в шесть символов.
        if self._is_family(k):
            return None, None
        for kk, v in self.by_key.items():
            if kk.startswith(k) and kk != k and len(kk) - len(k) <= 6:
                if not any(x in kk[len(k):] for x in VARIANT):
                    return v, 'SHORT_FORM'
        return None, None

    def _is_family(self, k):
        """Под приставку подходит несколько карточек с разным метражом.

        Тот же критерий, что у правила уровня бренда, и по той же причине:
        если выбор карточки меняет метраж, то выбирать за автора нельзя.
        """
        if len(k) < 6:
            return True                          # слишком коротко, чтобы быть артикулом
        ms = {v['m_per_100g'] for kk, v in self.by_key.items()
              if kk.startswith(k) and kk != k}
        return len(ms - {None}) > 1

    def is_family(self, article):
        return self._is_family(norm_key(article))

    def lookup_before(self, text, brand, max_words=3):
        """Линейка названа ПЕРЕД маркой: «Rasta Malabrigo (150гр/82м)».

        Разбор идёт вперёд от марки, и в таком порядке хвост оказывается
        пустым — дальше сразу скобка, — а описание получает «названа только
        марка» вместо артикула. В русском тексте оба порядка равноправны:
        «Rasta Malabrigo» и «Malabrigo Rasta» — одна пряжа.

        Догадка проверяется справочником: принимаем только точное попадание
        в карточку. Придумать несуществующий артикул правило поэтому не
        может — оно способно лишь узнать имеющийся, собранный в другом
        порядке. Длинные варианты пробуем первыми, чтобы «Baby Wool Alize»
        не выродилось в «Alize Wool».
        """
        if not brand:
            return None
        # Ищем ЛЮБОЕ написание марки, а не каноническое. «Lana Grossa» в
        # тексте бывает слитно — «Per Fortuna LanaGrossa», — и поиск по
        # имени из справочника такое вхождение просто не находил: правило
        # молчало, хотя карточка есть.
        for m in ALIAS_RE.finditer(text):
            if ALIAS_TO_BRAND.get(m.group(1).lower()) != brand:
                continue
            words = TOKEN.findall(text[max(0, m.start() - 60):m.start()])
            # «ALTA MODA COTOLANA от Lana Grossa» — предлог между линейкой и
            # маркой к названию не относится.
            while words and words[-1].lower().strip('.') in ('от', 'из', 'by', 'from'):
                words.pop()
            for k in range(min(max_words, len(words)), 0, -1):
                tail = words[-k:]
                if all(w.lower().strip('.') in STOP_WORDS for w in tail):
                    continue
                card, rule = self.lookup(f"{brand} {' '.join(tail)}")
                if card and rule == 'EXACT':
                    return card
        return None

    def lookup_lines(self, text):
        """Линейки без марки, подтверждённые метражом автора.

        Правило самое рискованное из всех: оно ищет название в свободном
        тексте, где марки рядом нет. Поэтому подтверждение обязательно и
        приходит от независимой величины — метража, который автор написал
        сам. Проверено на всей базе: без него правило даёт 3346 совпадений,
        из которых верных меньше трети («Пехорка Мериносовая» ловится в
        «мериносовая шерсть», «Loro Piana Cashmere» — в «Cashmere 16 fine»);
        с ним остаётся 1032, и они читаются как настоящие.

        Места, где марка названа явно, вычёркиваем: там уже отработали
        сильные правила, и второй раз то же упоминание считать незачем.
        """
        masked = ALIAS_RE.sub(' ', text or '')
        toks = list(TOKEN.finditer(masked))
        used, out = set(), []
        # Длинное имя выигрывает: иначе «Brushed Alpaca Silk» даст ещё и
        # «Brushed Alpaca», а «Fashion Modern Tweed Aran» — «…Tweed».
        for n in (4, 3, 2, 1):
            for i in range(len(toks) - n + 1):
                if any(j in used for j in range(i, i + n)):
                    continue
                k = norm_key(' '.join(x.group(0) for x in toks[i:i + n]))
                card = self.by_line.get(k)
                if card is None:
                    continue
                # Перед именем число или процент — это состав, а не название.
                if i and re.fullmatch(r'\d+', toks[i - 1].group(0)):
                    continue
                if masked[max(0, toks[i].start() - 2):toks[i].start()].strip().endswith('%'):
                    continue
                window = masked[toks[i].start():toks[i + n - 1].end() + 70]
                target = card['m_per_100g']
                if any(abs(x - target) <= max(3, target * 0.03)
                       for x in _metrages(window)):
                    used.update(range(i, i + n))
                    out.append((card, masked[toks[i].start():toks[i + n - 1].end()]))
        return out

    def lookup_correction(self, article):
        """Автор ошибся, но мы знаем, что он имел в виду.

        Соответствие сверено человеком по сайтам производителей и лежит в
        corrections.py. Оставлять описание без артикула из-за давней
        опечатки незачем — смысл понятен. В карточку опечатка при этом не
        попадает: связь запоминает авторские слова в rawMention.
        """
        return self._corrections.get(norm_key(article))

    def lookup_parent_brand(self, article):
        """Карточка названа полнее: «Schachenmayr Regia Premium Silk».

        У части марок есть материнская: Regia принадлежит Schachenmayr,
        Ecafil — Kutnor. В справочнике карточка записана с обеими, автор
        пишет только дочернюю. «Краткое написание» это не ловит — у него
        порог в шесть символов, а «schachenmayr» длиннее.

        Условия жёсткие, иначе правило начнёт хватать подлинейки:
        отрезанная приставка должна быть ИМЕНЕМ МАРКИ из словаря целиком,
        ключ упоминания — не короче десяти символов, а подходящая карточка
        ровно одна. Правило стоит последним и срабатывает только там, где
        не нашли все остальные, поэтому вытеснить чужую связь не может.
        """
        k = norm_key(article)
        if len(k) < 10:
            return None
        found = {}
        for kk, card in self.by_key.items():
            if kk != k and kk.endswith(k) and kk[:-len(k)] in self._brand_keys:
                found[card['id']] = card
        return next(iter(found.values())) if len(found) == 1 else None

    def lookup_typo(self, article, metrage_per_100g):
        """Опечатка в один-два символа, подтверждённая метражом.

        «batic» вместо «Batik», «LundLust» вместо «Landlust», «Meronocot»
        вместо «Merinocot». Само по себе расстояние редактирования тут не
        работает: «Casagrande Angora 70» и «Angora 80» отличаются одним
        символом, но это разная пряжа, как и «Пехорка Осенняя» с «Весенняя».

        Поэтому два ограничителя, и оба обязательны:
          • метраж из авторского текста должен сойтись с карточкой —
            он и отсеивает «Осеннюю» от «Весенней»;
          • цифры в ключах обязаны совпадать. Цифра почти всегда несёт
            смысл: вес, сложение, версия («Angora 70/80», «Socke 75/6f»).

        Проход по всему справочнику с отсечением — это пакетная работа,
        онлайновому пути такое давать нельзя.
        """
        if metrage_per_100g is None:
            return None
        k = norm_key(article)
        if len(k) < 8:
            return None
        digits = re.sub(r'\D', '', k)
        found = {}
        for kk, card in self.by_key.items():
            if kk == k or re.sub(r'\D', '', kk) != digits:
                continue
            if _edit_within(k, kk, 2):
                found[card['id']] = card
                if len(found) > 1:
                    return None
        if len(found) != 1:
            return None
        card = next(iter(found.values()))
        m = card.get('m_per_100g')
        if not m or abs(metrage_per_100g - m) > max(8, m * 0.04):
            return None
        return card

    def is_generic_name(self, name):
        """Название совпадает с родовой карточкой («Пух норки», «Эко-норка»)."""
        if not name:
            return False
        k = norm_key(name)
        return any(norm_key(g) == k for g in self.generic)

    def lookup_brand(self, brand):
        """Уровень бренда: линейка не названа, но у марки она одна по метражу."""
        return self.brand_ok.get(norm_key(brand or ''))

    def lookup_generic(self, text):
        """Родовое название — последнее правило, по тексту целиком.

        Работает по тексту, из которого вычеркнуты брендовые совпадения:
        иначе «Color City Норка» отдало бы связь на родовую карточку.
        Границы слов обязательны — без них «минк» ловится внутри «изюминкой».
        """
        rest = BRANDED_GENERIC.sub(' ', text or '')
        out = []
        for name, rx in GENERIC_RULES:
            if name in self.generic and rx.search(rest):
                out.append(self.generic[name])
                rest = rx.sub(' ', rest)
        return out
