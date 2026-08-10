import re

from .utils import _nearest_clause_boundary


def parse_yarn(text):
    results = []
    # \.? after the unit letters: abbreviation-with-period style ("150 м./50 гр.",
    # "50 гр./150 м") is common enough that without it, the literal "." sitting
    # between the unit and the separator/next number breaks the match entirely.
    # "," in the separator class: "50гр, 167м" (comma-space, no other joiner)
    # found on lenakotikova.ru — without it, the comma sits between the two
    # numbers unmatched by any alternative, breaking the match entirely.
    # (?:\s*-\s*\d+(?:[.,]\d+)?)? after each captured number — same "take the
    # first/lower value" fix already applied to parse_density's dash-ranges.
    # Without it, a stated range like "300-375м/100г" grabs 375 (the digit
    # adjacent to the unit marker) instead of 300 (the first/lower value
    # convention). (?:[.,]\d+)? on the captured number itself allows a
    # decimal ("387,5 м/100 гр") — without it, "387,5" only matches its
    # fractional half ("5 м/100 гр"), producing a bogus near-zero result.
    # Unit tokens are tightened to actual meter/gram words instead of a bare
    # "м"/"г" + any following letters — the loose version matched the FIRST
    # letter of any м-/г-word (e.g. "0-9 месяцев", "2 года" — an age-range
    # label, nothing to do with yarn), fabricating a yarn match out of
    # unrelated size-chart text (found on viajeuvie.com: "0-9 месяцев = 1
    # моток; 9 мес. – 2 года" was misread as "9 м / 2 г").
    # dash class covers en-dash "–" and em-dash "—" alongside the plain
    # hyphen — "110 метров – 50 грамм" (en-dash, found on viajeuvie.com)
    # otherwise doesn't match "-" in either the separator or the dash-range
    # swallow group, silently dropping the entire yarn spec.
    dash = r'[-–—]'
    unit_m = r'(?:метр[а-я]*|м(?![а-я]))'
    unit_g = r'(?:гр[а-я]*|г(?![а-я])|g)'
    pattern1 = re.compile(rf'(\d+(?:[.,]\d+)?)(?:\s*{dash}\s*\d+(?:[.,]\d+)?)?\s*{unit_m}\.?\s*(?:в|на|/|{dash}|,)?\s*(\d+(?:[.,]\d+)?)(?:\s*{dash}\s*\d+(?:[.,]\d+)?)?\s*{unit_g}\.?', re.IGNORECASE)
    pattern2 = re.compile(rf'(\d+(?:[.,]\d+)?)(?:\s*{dash}\s*\d+(?:[.,]\d+)?)?\s*{unit_g}\.?\s*(?:в|на|/|{dash}|,)?\s*(\d+(?:[.,]\d+)?)(?:\s*{dash}\s*\d+(?:[.,]\d+)?)?\s*{unit_m}\.?', re.IGNORECASE)

    matches = []
    for m in pattern1.finditer(text):
        matches.append((m, m.group(1), m.group(2)))
    for m in pattern2.finditer(text):
        matches.append((m, m.group(2), m.group(1)))

    word_to_num = {'две': 2, 'три': 3, 'четыре': 4, 'пять': 5, 'шесть': 6}

    for match, meters, grams in matches:
        m_val = float(meters.replace(',', '.'))
        g_val = float(grams.replace(',', '.'))
        if g_val == 0: continue
        
        m_per_100 = (m_val * 100) / g_val
        
        start = max(0, match.start() - 35)
        end = min(len(text), match.end() + 35)
        context = text[start:end].lower()

        # "1500 м/100 гр ... в 5 сложений, итоговый метраж = 300 м/100 гр" —
        # the author's own already-divided final value sits close enough to
        # the "в N сложений" thread-count phrase (describing the RAW value
        # stated earlier) that its context window reaches it too, dividing
        # an already-final number a second time. "итогов" immediately before
        # a match is an explicit "this is the final value" marker — skip the
        # division for that specific match when present.
        final_marker = 'итогов' in text[max(0, match.start() - 25):match.start()].lower()

        thread_match = re.search(r'в\s+(\d+|две|три|четыре|пять|шесть)\s+(?:нит|слож)', context)
        if thread_match and not final_marker:
            val = thread_match.group(1)
            threads = int(val) if val.isdigit() else word_to_num.get(val, 1)
            m_per_100 = m_per_100 / threads

        results.append(m_per_100)
    return results


def parse_density(text):
    # \b after the bare abbreviations (п, ст, р) — without it, "п" alone matches
    # the first letter of ANY п-starting word (плотности, пряжа...), e.g. "На
    # выбор 2 плотности: 21 п. * 30 р." wrongly reads "2" (from "2 плотности")
    # as the stitch count instead of "21". пет.../столб.../ряд... already end in
    # [а-я]*, which greedily consumes to a real word boundary, so they're unaffected.
    # (?:\s*-\s*\d+...)? after each captured number — swallows a dash-range's
    # upper bound ("23-25 п") so group1/group2 land on the FIRST/lower number,
    # consistent with the "always take the first value" convention. Without it,
    # the number immediately adjacent to the unit marker wins (here, "25"), since
    # the marker check runs right after the capture with nothing to skip past it.
    pattern = re.compile(r'(\d+(?:[.,]\d+)?)(?:\s*-\s*\d+(?:[.,]\d+)?)?\s*(?:п\b|пет[а-я]*|ст\b|столб[а-я]*)(?:.{1,30}?)(\d+(?:[.,]\d+)?)(?:\s*-\s*\d+(?:[.,]\d+)?)?\s*(?:р\b|ряд[а-я]*)', re.IGNORECASE)
    for m in pattern.finditer(text):
        stitches_str = m.group(1).replace(',', '.')
        rows_str = m.group(2).replace(',', '.')
        try:
            stitches = float(stitches_str)
            rows = float(rows_str)
        except:
            continue
            
        start = max(0, m.start() - 60)
        end = min(len(text), m.end() + 30)

        # Clip the ignore/allow-word search to the CURRENT clause — stop at
        # the nearest sentence/clause boundary (, ; .) in each direction,
        # skipping any that sit inside parentheses (see _in_parens), and
        # never a colon (which connects a qualifier label to ITS OWN value,
        # e.g. "в узоре: 42 п." — a colon there must stay visible). Without
        # this, a page stating two densities back-to-back ("Плотность в
        # узоре: 42 п. ..., в лицевой глади: 31 п. ...") leaks the SECOND
        # clause's "в лицевой глади" into the FIRST (узор) match's forward
        # window, wrongly un-excluding it (found on alenabarteneva.ru).
        backward_boundary = _nearest_clause_boundary(text, start, m.start(), from_right=True)
        if backward_boundary != -1:
            start = backward_boundary + 1

        forward_boundary = _nearest_clause_boundary(text, m.end(), end, from_right=False)
        if forward_boundary != -1:
            end = forward_boundary

        context = text[start:end].lower()

        ignore_roots = ['узор', 'резин', 'ажур', 'платоч', 'аран', 'кос', 'рельеф']
        has_ignore = any(r in context for r in ignore_roots)
        has_allow = 'лицев' in context or 'глад' in context
        
        if has_ignore and not has_allow:
            continue
            
        is_1x1 = '1х1 см' in context or '1x1 см' in context or (stitches < 8 and rows < 8)
        if is_1x1:
            stitches *= 10
            rows *= 10

        # round(x) with no ndigits rounds to the nearest INTEGER, silently
        # destroying legitimate fractional gauge values from the source text
        # (e.g. "26,2 столбика и 12,7 рядов" -> (26, 13), losing both
        # decimals — found via lenakotikova.ru's pillow-cover series, whose
        # gauge is routinely given to one decimal place). round(x, 1) keeps
        # that precision while still trimming float noise from the str->float
        # conversion above.
        return round(stitches, 1), round(rows, 1)
    return None, None

def detect_instruments(text, instruments_db):
    # Крючок vs спицы — determined from word roots anywhere in the page text
    # (title + description). "крюч" covers крючок/крючком/крючка; "столбик"
    # (crochet-only stitch term) is a secondary signal for pages that describe
    # the technique without ever naming the tool directly. "спиц" covers
    # спицы/спицами/спицах. Single-technique shops sometimes never say "спицами"
    # at all (it's implicit store-wide) but do give a gauge in "N петель" —
    # "петл" is a needles fallback signal, but only when no crochet signal is
    # present, since crochet occasionally uses "петля" too (воздушная петля,
    # петля подъёма) — always alongside an explicit "крючок" mention in practice.
    text_lower = text.lower()
    has_crochet = bool(re.search(r'крюч|столбик', text_lower))
    # \b-anchored: "петля" declines with a fleeting vowel (петля/петли but
    # петель, петелька), so both пет+л... and пет+ел... stems are needed. Word
    # boundary keeps this from matching inside unrelated words that happen to
    # contain "пет" (компетентный, Петербург, петух...).
    has_needles = bool(re.search(r'спиц', text_lower)) or (not has_crochet and bool(re.search(r'\bпет(?:л[а-я]*|ел[а-я]*)\b', text_lower)))
    result = []
    for i_id, i_name in instruments_db:
        name_lower = i_name.lower()
        if 'крюч' in name_lower and has_crochet:
            result.append({"id": i_id, "name": i_name})
        elif 'спиц' in name_lower and has_needles:
            result.append({"id": i_id, "name": i_name})
    return result

def is_machine_knitting(text):
    # Machine knitting (вязальная машина) isn't a technique we track at all — no
    # Instrument row exists for it, and it's explicitly out of scope. "фонтур"
    # (single/double-bed terminology) is unambiguous; the phrase forms cover
    # sites that only ever say "для машин"/"машинное вязание" without "фонтур".
    return bool(re.search(r'фонтур|вязальн[а-я]*\s*машин|машинн[а-я]*\s*вязан|для\s+машин[а-я]*\b', text.lower()))

