# -*- coding: utf-8 -*-
"""Нормализация названий пряжи.

Обязана давать тот же результат, что apps/backend/src/utils/yarnKeys.ts:
справочник собирается здесь, а поиск в админке идёт оттуда. Совпадение
проверено на всех 2209 именах и 336 псевдонимах справочника.
"""
import re
import unicodedata

from .clean import translit, dedup_key as _dedup_key

# Кириллические буквы, неотличимые от латинских: магазины пишут «Alize»
# вперемешку с «Аlize», где первая буква кириллическая.
HOMO = str.maketrans('аеосхурмвнткАЕОСХУРМВНТК', 'aeocxypmbhtkAEOCXYPMBHTK')


def norm_words(name):
    """Имя -> список нормализованных слов.

    Слова нужны отдельно: ключ дедупа строится из их множества, и склеенная
    строка для него не годится.
    """
    s = unicodedata.normalize('NFKC', name or '').translate(HOMO).lower()
    s = re.sub(r'\b(concept|by)\b', ' ', s)      # «Concept by Katia» = «Katia»
    return re.findall(r'[a-z0-9]+', translit(s))


def norm_key(name):
    """Ключ сравнения: только буквы и цифры, без пробелов. Уникален в БД."""
    return ''.join(norm_words(name))


def dedup_key(name):
    """Ключ дедупа: отсортированное множество слов."""
    return _dedup_key(norm_words(name))
