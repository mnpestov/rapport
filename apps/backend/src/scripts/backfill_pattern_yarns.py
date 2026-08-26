# -*- coding: utf-8 -*-
"""Этап 3 плана YARN_ARTICLES_PLAN.md — связи «описание ↔ артикул».

Разбирает актуальные Pattern.details, сопоставляет со справочником в БД и
пишет PatternYarn (source = BACKFILL) либо PatternYarnMention для того, что
не распозналось.

Перезапуск устроен как «удалить своё, потом вставить»:

  1. Удаляются связи BACKFILL со статусом ACTIVE и упоминания в статусе
     PENDING — по обрабатываемым описаниям. Именно удаление даёт
     идемпотентность и возможность ПОЧИНИТЬ неверную связь: без него
     перезапуск умеет только добавлять.
  2. Вставка идёт ON CONFLICT DO NOTHING. Это защита не от повторного
     прогона (её дал шаг 1), а от строк, переживших удаление: связь с
     source = ADMIN (человек добавил) и связь со status = REJECTED (человек
     удалил). Без второй половины перезапуск воскрешал бы то, что модератор
     уже отверг, и удалять пришлось бы по кругу.

Обе конструкции нужны, но по разным причинам — путать их нельзя.

  --dry-run   ничего не пишет, печатает те же счётчики
  --limit N   обработать только первые N описаний
"""
import argparse
import collections
import hashlib
import os
import re
import sys

import psycopg2
import psycopg2.extras

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from yarn_lib.analyze import analyze, details_hash, load_index
from yarn_lib.extract import extract_brand_hits, extract_art_hits
from yarn_lib.match import YarnIndex

DB_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5434/knitting_catalog")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()
    index = load_index(cur, YarnIndex)
    print(f"справочник: {len(index.cards)} карточек, "
          f"{len(index.brand_ok)} марок проходят правило уровня бренда, "
          f"{len(index.generic)} родовых")

    cur.execute("""SELECT id, details FROM "Pattern"
                    WHERE details IS NOT NULL AND details <> ''
                    ORDER BY id""" + (f" LIMIT {args.limit}" if args.limit else ""))
    patterns = cur.fetchall()

    links = []            # (pattern_id, yarn_id, raw, metrage, rule, hash)
    mentions = []         # (pattern_id, raw, metrage, kind, suggested, rule, hash)
    stat = collections.Counter()
    per_pattern_linked = set()

    for pid, details in patterns:
        h = details_hash(details)
        found, missed = analyze(details, index, extract_brand_hits, extract_art_hits)
        for l in found:
            links.append((pid, l.yarn_id, l.raw_mention, l.metrage, l.rule, h))
            stat[l.rule] += 1
        for m in missed:
            mentions.append((pid, m.raw_text, m.metrage, m.kind, None, None, h))
            stat['mention:' + m.kind] += 1
        if found:
            per_pattern_linked.add(pid)

    print(f"\nописаний обработано:  {len(patterns)}")
    print(f"связей:               {len(links)} на {len(per_pattern_linked)} описаний")
    print(f"упоминаний отложено:  {len(mentions)}")
    for k in sorted(stat, key=lambda x: -stat[x]):
        print(f"   {stat[k]:6}  {k}")

    if args.dry_run:
        print("\n[dry-run] ничего не записано")
        return

    ids = [p[0] for p in patterns]
    cur.execute("""DELETE FROM "PatternYarn"
                    WHERE source = 'BACKFILL' AND status = 'ACTIVE'
                      AND "patternId" = ANY(%s)""", (ids,))
    deleted_links = cur.rowcount
    cur.execute("""DELETE FROM "PatternYarnMention"
                    WHERE status = 'PENDING' AND "patternId" = ANY(%s)""", (ids,))
    deleted_mentions = cur.rowcount

    # execute_values бьёт вставку на страницы, и cur.rowcount после неё
    # показывает только последнюю. Считаем по таблице до и после — иначе
    # «пропущено связей» врёт на порядок и выглядит как массовый конфликт.
    def count(table):
        cur.execute(f'SELECT count(*) FROM "{table}"')
        return cur.fetchone()[0]

    before_links, before_mentions = count("PatternYarn"), count("PatternYarnMention")

    psycopg2.extras.execute_values(cur, """
        INSERT INTO "PatternYarn"
               (id, "patternId", "yarnId", "rawMention", "metrageInText",
                source, status, "matchRule", "detailsHash")
        VALUES %s
        ON CONFLICT ("patternId", "yarnId") DO NOTHING
    """, [(pid, yid, raw, met, rule, h) for pid, yid, raw, met, rule, h in links],
        template="""(gen_random_uuid(), %s, %s, %s, %s, 'BACKFILL', 'ACTIVE', %s, %s)""")
    inserted_links = count("PatternYarn") - before_links

    psycopg2.extras.execute_values(cur, """
        INSERT INTO "PatternYarnMention"
               (id, "patternId", "rawText", "metrageInText", kind,
                "suggestedYarnId", "matchRule", status, "detailsHash", "updatedAt")
        VALUES %s
        ON CONFLICT ("patternId", "rawText") DO NOTHING
    """, mentions,
        template="""(gen_random_uuid(), %s, %s, %s, %s::"YarnMentionKind",
                     %s, %s::"YarnMatchRule", 'PENDING', %s, now())""")
    inserted_mentions = count("PatternYarnMention") - before_mentions

    conn.commit()
    print(f"\nудалено: связей {deleted_links}, упоминаний {deleted_mentions}")
    print(f"записано: связей {inserted_links}, упоминаний {inserted_mentions}")
    skipped = len(links) - inserted_links
    if skipped:
        print(f"пропущено связей (ADMIN или REJECTED): {skipped}")


if __name__ == "__main__":
    main()
