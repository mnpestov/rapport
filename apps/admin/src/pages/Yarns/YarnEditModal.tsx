import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button, IconButton } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { YarnItem, YarnUpdatePayload, FiberTypeItem } from "../../api/yarns";
import { getYarnBrands, getYarnLines, getFiberTypes, createFiberType } from "../../api/yarns";
import { useAuth } from "../../contexts/AuthContext";
import styles from "./Yarns.module.css";

interface Props {
  yarn: YarnItem | null;
  /** Подставить название заранее — при создании из подсказки, где ничего не нашлось. */
  initialName?: string;
  onClose: () => void;
  onSave: (data: YarnUpdatePayload) => void;
}

/** Строка редактора состава — до сохранения волокно может быть ещё не выбрано. */
interface CompositionRow {
  key: string; // React key, стабилен независимо от того, выбрано ли уже волокно
  fiberType: FiberTypeItem | null;
  percentage: string; // строкой по той же причине, что mPer100g в основной форме
}

let compositionRowSeq = 0;
const newCompositionRow = (): CompositionRow => ({
  key: `new-${++compositionRowSeq}`,
  fiberType: null,
  percentage: "",
});

/**
 * Форма карточки артикула. Поля оставлены минимально необходимые:
 *
 * - Бренд (обязателен, если не родовая карточка) — с autocomplete по существующим
 * - Артикул (необязателен) — с autocomplete по существующим
 * - Родовое название (только для админа)
 * - Метраж м/100г (обязателен при создании новой карточки, необязателен при
 *   редактировании существующей — в БД есть старые записи без него)
 * - Плотность производителя (необязательна)
 * - Состав (обязателен при создании новой карточки, необязателен при
 *   редактировании существующей — та же причина, что у метража)
 *
 * Имя артикула формируется на бэкенде из бренда + артикула, поэтому поле
 * «Название» убрано: дублирует пару Бренд/Артикул и провоцирует опечатки.
 */
export function YarnEditModal({ yarn, initialName, onClose, onSave }: Props) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const [form, setForm] = useState({
    brand: yarn?.brand ?? "",
    line: yarn?.line ?? "",
    isGeneric: yarn?.isGeneric ?? false,
    mPer100g: yarn?.mPer100g?.toString() ?? "",
    densityRaw: yarn?.densityRaw ?? "",
    composition: yarn?.composition ?? "",
  });

  // Строки структурированного состава — заполняются из yarn.compositions
  // (то, что уже распознано автоматически при заливке справочника или
  // сохранено предыдущей правкой). Пустой список у новой/ещё не разобранной
  // карточки — админ добавляет строки вручную кнопкой «Добавить волокно».
  const [compositionRows, setCompositionRows] = useState<CompositionRow[]>(() =>
    (yarn?.compositions ?? []).map((c) => ({
      key: c.id,
      fiberType: c.fiberType,
      percentage: c.percentage != null ? String(c.percentage) : "",
    })),
  );

  const set = (k: keyof typeof form, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Числовые поля живут в форме строками — иначе поле нельзя очистить, не
  // проходя через NaN. Пустая строка → null: «метраж неизвестен» ≠ «метраж 0».
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const payload = (): YarnUpdatePayload => {
    const brand = form.brand.trim() || null;
    const line = form.line.trim() || null;
    // Имя = «Бренд Линейка» или только одно из них если второго нет.
    const nameParts = [brand, line].filter(Boolean);
    const name = nameParts.join(" ") || yarn?.name || "";
    // Строки без выбранного волокна (админ нажал «Добавить», но не
    // успел/не стал заполнять) молча отбрасываются — не превращаем
    // незаконченный ввод в ошибку сохранения.
    const compositions = compositionRows
      .filter((r) => r.fiberType != null)
      .map((r) => ({ fiberTypeId: r.fiberType!.id, percentage: num(r.percentage) }));
    return {
      name,
      brand,
      line,
      isGeneric: form.isGeneric,
      mPer100g: num(form.mPer100g),
      compositions,
      densityRaw: form.densityRaw.trim() || null,
      composition: form.composition.trim() || null,
    };
  };

  // Валидация: бренд обязателен всегда (кроме родовых карточек). Метраж и
  // состав обязательны только при СОЗДАНИИ новой карточки — при
  // редактировании уже существующей записи они могут быть пусты в БД
  // (частый случай для старых карточек), и раньше это блокировало
  // сохранение любых правок, даже если админ менял совсем другое поле.
  // Артикул необязателен в обоих случаях. «Состав» для валидации — это
  // структурированные строки (хотя бы одно волокно выбрано), а не сырой
  // текст: у новой карточки его просто ещё нет, вводить его отдельно от
  // структуры незачем.
  const isNew = !yarn;
  const hasComposition = compositionRows.some((r) => r.fiberType != null);
  const isValid =
    (form.isGeneric || form.brand.trim() !== "") &&
    (!isNew || (form.mPer100g.trim() !== "" && hasComposition));

  return (
    <Modal isOpen onClose={onClose} title={yarn ? "Артикул" : "Новый артикул"} maxWidth={560}>
      <div className={styles.form}>
        {/* Подсказка — что искали при создании */}
        {!yarn && initialName && (
          <p className={styles.fieldWide} style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", fontFamily: "Mulish, sans-serif" }}>
            Создание для: <strong>{initialName}</strong>
          </p>
        )}
        {/* Бренд — autocomplete */}
        <AutocompleteField
          label="Бренд"
          value={form.brand}
          onChange={(v) => set("brand", v)}
          fetchSuggestions={getYarnBrands}
          placeholder="Alize, Drops, Garn Studio…"
          required={!form.isGeneric}
          hint={form.isGeneric ? "Родовые карточки без бренда" : undefined}
        />

        {/* Артикул — autocomplete */}
        <AutocompleteField
          label="Артикул"
          value={form.line}
          onChange={(v) => set("line", v)}
          fetchSuggestions={getYarnLines}
          placeholder="Angora Gold, Loves You…"
        />

        {/* Чекбокс «Родовое» — только для админа */}
        {isAdmin && (
          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={form.isGeneric}
              onChange={(e) => set("isGeneric", e.target.checked)}
            />
            <span>
              Родовое название
              <span className={styles.hint}>
                Категория без марки — «Пух норки», «Эко-норка». У таких бренд не требуется.
              </span>
            </span>
          </label>
        )}

        {/* Метраж — обязательно при создании новой карточки */}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Метраж, м/100 г{isNew && " *"}</span>
          <input
            className={styles.fieldInput}
            value={form.mPer100g}
            placeholder="например, 350"
            inputMode="numeric"
            onChange={(e) => set("mPer100g", e.target.value)}
          />
        </label>

        {/* Плотность производителя — необязательное */}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Плотность производителя</span>
          <input
            className={styles.fieldInput}
            value={form.densityRaw}
            placeholder="22 п. × 30 р."
            onChange={(e) => set("densityRaw", e.target.value)}
          />
          <span className={styles.hint}>
            Плотность вязания, указанная на мотке — число петель и рядов на 10 × 10 см.
          </span>
        </label>

        {/* Состав — структурированный редактор на всю ширину. Исходный
            текст (как ввёл пользователь/скрапер) показан НАД редактором
            как read-only подсказка: помогает админу сверяться при разборе
            неоднозначных формулировок, но сам не редактируется — источник
            правды после этой формы это compositionRows/YarnComposition. */}
        <div className={styles.fieldWide}>
          <span className={styles.fieldLabel}>Состав{isNew && " *"}</span>
          {yarn?.composition && (
            <p className={styles.compositionRawHint}>Как ввёл пользователь: «{yarn.composition}»</p>
          )}
          <CompositionEditor rows={compositionRows} onChange={setCompositionRows} />
        </div>
      </div>

      <div className={styles.modalFoot}>
        <Button variant="secondary" onClick={onClose}>
          Отмена
        </Button>
        <Button disabled={!isValid} onClick={() => onSave(payload())}>
          Сохранить
        </Button>
      </div>
    </Modal>
  );
}

// ─── Редактор структурированного состава ───────────────────────────────────

interface CompositionEditorProps {
  rows: CompositionRow[];
  onChange: (rows: CompositionRow[]) => void;
}

/**
 * Построчный список волокон состава: на каждую строку — автокомплит по
 * FiberType (с inline-созданием нового волокна, если нужного нет в
 * справочнике) и необязательное поле доли в процентах. Сумма долей
 * подсвечивается предупреждением, если заполнена только часть строк и не
 * сходится к 100 — но не блокирует сохранение: в справочнике много карточек,
 * где доля части компонентов не указана в принципе.
 */
function CompositionEditor({ rows, onChange }: CompositionEditorProps) {
  const updateRow = (key: string, patch: Partial<CompositionRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const removeRow = (key: string) => onChange(rows.filter((r) => r.key !== key));

  const addRow = () => onChange([...rows, newCompositionRow()]);

  const filledPercentages = rows
    .map((r) => (r.percentage.trim() === "" ? null : Number(r.percentage)))
    .filter((v): v is number => v != null);
  const allFilled = filledPercentages.length === rows.length && rows.length > 0;
  const sum = filledPercentages.reduce((a, b) => a + b, 0);
  const showSumWarning = allFilled && sum !== 100;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((row) => (
        <div key={row.key} className={styles.compositionRow}>
          <div className={styles.compositionRowField}>
            <FiberAutocompleteField
              value={row.fiberType}
              onChange={(fiberType) => updateRow(row.key, { fiberType })}
            />
          </div>
          <input
            className={`${styles.fieldInput} ${styles.compositionPercentInput}`}
            value={row.percentage}
            placeholder="%"
            inputMode="numeric"
            onChange={(e) => updateRow(row.key, { percentage: e.target.value })}
          />
          <IconButton
            className={styles.compositionRemoveBtn}
            title="Убрать волокно"
            onClick={() => removeRow(row.key)}
          >
            <X size={16} />
          </IconButton>
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Button variant="secondary" onClick={addRow}>
          Добавить волокно
        </Button>
        {rows.length > 0 && (
          <span className={`${styles.compositionSum}${showSumWarning ? ` ${styles.compositionSumWarning}` : ""}`}>
            {allFilled ? `Сумма: ${sum}%${showSumWarning ? " — не сходится к 100%" : ""}` : "Доля указана не для всех волокон"}
          </span>
        )}
      </div>
    </div>
  );
}

interface FiberAutocompleteFieldProps {
  value: FiberTypeItem | null;
  onChange: (fiberType: FiberTypeItem | null) => void;
}

/**
 * Автокомплит по справочнику волокон + возможность создать новое прямо
 * тут же. Текстовый ввод, пока волокно не выбрано, живёт в query — как
 * только пользователь кликает подсказку, поле переключается на
 * "выбранное" состояние (показывает displayName, x чтобы сбросить выбор).
 */
function FiberAutocompleteField({ value, onChange }: FiberAutocompleteFieldProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<FiberTypeItem[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [creating, setCreating] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await getFiberTypes(q || undefined);
        setSuggestions(res.items);
        setOpen(true);
        setActiveIdx(-1);
      } catch {
        setSuggestions([]);
      }
    }, 220);
  }, []);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const handleQueryChange = (v: string) => {
    setQuery(v);
    load(v);
  };

  const handleSelect = (item: FiberTypeItem) => {
    onChange(item);
    setQuery("");
    setOpen(false);
  };

  const handleClear = () => {
    onChange(null);
    setQuery("");
  };

  const handleCreate = async () => {
    const baseFiber = query.trim();
    if (!baseFiber) return;
    setCreating(true);
    try {
      const created = await createFiberType({ baseFiber });
      handleSelect(created);
    } finally {
      setCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      handleSelect(suggestions[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  // Волокно уже выбрано — показываем displayName + кнопку сброса вместо
  // текстового инпута, чтобы не путать "выбрано X" с "ищу X".
  if (value) {
    return (
      <div className={styles.autocompleteWrap} ref={wrapRef}>
        <div className={styles.fieldInput} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>{value.displayName}</span>
          <IconButton title="Изменить волокно" onClick={handleClear}>
            <X size={14} />
          </IconButton>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.autocompleteWrap} ref={wrapRef}>
      <input
        className={styles.fieldInput}
        value={query}
        placeholder="Меринос, хлопок, альпака…"
        autoComplete="off"
        onChange={(e) => handleQueryChange(e.target.value)}
        onFocus={() => load(query)}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <div className={styles.suggestions}>
          {suggestions.map((item, idx) => (
            <div
              key={item.id}
              className={`${styles.suggestionItem}${idx === activeIdx ? ` ${styles.active}` : ""}`}
              onMouseDown={() => handleSelect(item)}
            >
              {item.displayName}
            </div>
          ))}
          {query.trim() !== "" && !suggestions.some((s) => s.displayName.toLowerCase() === query.trim().toLowerCase()) && (
            <div
              className={styles.suggestionItem}
              style={{ color: "var(--brand-bright)" }}
              onMouseDown={handleCreate}
            >
              {creating ? "Создаём…" : `+ Добавить «${query.trim()}» как новое волокно`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Autocomplete-поле ──────────────────────────────────────────────────────

interface AutocompleteFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  fetchSuggestions: (q?: string) => Promise<{ items: string[] }>;
  placeholder?: string;
  required?: boolean;
  hint?: string;
}

function AutocompleteField({
  label,
  value,
  onChange,
  fetchSuggestions,
  placeholder,
  required,
  hint,
}: AutocompleteFieldProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    (q: string, showDropdown: boolean) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          const res = await fetchSuggestions(q || undefined);
          setSuggestions(res.items);
          if (showDropdown) {
            setOpen(res.items.length > 0);
          }
          setActiveIdx(-1);
        } catch {
          setSuggestions([]);
        }
      }, 220);
    },
    [fetchSuggestions],
  );

  // При монтировании только предзагружаем список, НЕ открываем дропдаун.
  useEffect(() => {
    load("", false);
    // Закрываем список по клику вне компонента.
    const onOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [load]);

  const handleChange = (v: string) => {
    onChange(v);
    load(v, true);
  };

  const handleSelect = (item: string) => {
    onChange(item);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      handleSelect(suggestions[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>
        {label}
        {required && " *"}
      </span>
      <div className={styles.autocompleteWrap} ref={wrapRef}>
        <input
          className={styles.fieldInput}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onKeyDown={handleKeyDown}
        />
        {open && (
          <div className={styles.suggestions}>
            {suggestions.map((item, idx) => (
              <div
                key={item}
                className={`${styles.suggestionItem}${idx === activeIdx ? ` ${styles.active}` : ""}`}
                onMouseDown={() => handleSelect(item)}
              >
                {item}
              </div>
            ))}
          </div>
        )}
      </div>
      {hint && <span className={styles.hint}>{hint}</span>}
    </label>
  );
}
