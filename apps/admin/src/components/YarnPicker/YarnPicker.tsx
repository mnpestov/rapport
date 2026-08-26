import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { suggestYarns, YarnSuggestItem } from "../../api/yarns";
import styles from "./YarnPicker.module.css";

export interface PickedYarn {
  id: string;
  name: string;
  /** Нужен там, где выбор сохраняется до создания описания (parsedData
      новинки): id может протухнуть от слияния, ключ — нет. */
  normalizedKey?: string;
  mPer100g: number | null;
  composition: string | null;
  /** Откуда связь: показываем, чтобы модератор видел, что пришло разбором. */
  source?: "SCRAPER" | "ADMIN" | "BACKFILL";
}

interface Props {
  value: PickedYarn[];
  onChange: (value: PickedYarn[]) => void;
  /** Открыть форму создания артикула с уже подставленным названием. */
  onCreateRequest?: (name: string) => void;
  disabled?: boolean;
}

const SOURCE_LABEL: Record<string, string> = {
  BACKFILL: "разбор",
  SCRAPER: "скрапер",
  ADMIN: "вручную",
};

/**
 * Выбор артикулов пряжи для описания. Один контрол на все места, где
 * описание редактируется: форма описания, карточка модерации и
 * SyncItemEditModal — иначе три копии разъедутся.
 *
 * Подсказка запрашивается от трёх символов: справочник — 2778 карточек, и на
 * одной-двух буквах ответ бесполезен. Совпадение ищется по нормализованному
 * ключу, поэтому «ализе» находит Alize.
 */
export function YarnPicker({ value, onChange, onCreateRequest, disabled }: Props) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<YarnSuggestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // Ответы приходят не по порядку: на «ализ» может прийти позже, чем на
  // «ализе», и затереть свежий список старым. Сравниваем с последним
  // отправленным запросом.
  const lastQuery = useRef("");

  useEffect(() => {
    const q = query.trim();
    lastQuery.current = q;
    if (q.length < 3) {
      setOptions([]);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await suggestYarns(q);
        if (lastQuery.current === q) setOptions(res.items);
      } catch {
        if (lastQuery.current === q) setOptions([]);
      } finally {
        if (lastQuery.current === q) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const picked = new Set(value.map((v) => v.id));
  const visible = options.filter((o) => !picked.has(o.id));

  const add = (o: YarnSuggestItem) => {
    onChange([...value, {
      id: o.id, name: o.name, normalizedKey: o.normalizedKey,
      mPer100g: o.mPer100g, composition: o.composition,
    }]);
    setQuery("");
    setOptions([]);
  };

  return (
    <div className={styles.wrapper} ref={boxRef}>
      {value.length > 0 && (
        <div className={styles.chips}>
          {value.map((y) => (
            <span key={y.id} className={styles.chip}>
              <span className={styles.chipName}>{y.name}</span>
              {/* Метраж и состав — справочно: по ним модератор видит, что
                  разбор привязал не соседнюю линейку с другой толщиной. */}
              {y.mPer100g != null && <span className={styles.chipMeta}>{y.mPer100g} м/100 г</span>}
              {y.source && y.source !== "ADMIN" && (
                <span className={styles.chipSource}>{SOURCE_LABEL[y.source]}</span>
              )}
              {!disabled && (
                <button
                  type="button"
                  className={styles.chipRemove}
                  onClick={() => onChange(value.filter((v) => v.id !== y.id))}
                  title="Убрать"
                >
                  <X size={13} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <div className={styles.inputRow}>
        <input
          className={styles.input}
          value={query}
          disabled={disabled}
          placeholder="Начните вводить название пряжи…"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        {loading && <Loader2 size={15} className={styles.spinner} />}
      </div>

      {open && query.trim().length >= 3 && (
        <div className={styles.dropdown}>
          {visible.map((o) => (
            <button type="button" key={o.id} className={styles.option} onClick={() => add(o)}>
              <span className={styles.optionName}>{o.name}</span>
              <span className={styles.optionMeta}>
                {o.mPer100g != null ? `${o.mPer100g} м/100 г` : "метраж неизвестен"}
                {o._count.patterns > 0 && ` · ${o._count.patterns} опис.`}
              </span>
            </button>
          ))}
          {!loading && visible.length === 0 && (
            <div className={styles.empty}>
              Ничего не найдено
              {onCreateRequest && (
                <button
                  type="button"
                  className={styles.createBtn}
                  onClick={() => onCreateRequest(query.trim())}
                >
                  <Plus size={14} /> Создать артикул «{query.trim()}»
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
