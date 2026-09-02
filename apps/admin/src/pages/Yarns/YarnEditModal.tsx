import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { YarnItem } from "../../api/yarns";
import { getYarnBrands, getYarnLines } from "../../api/yarns";
import { useAuth } from "../../contexts/AuthContext";
import styles from "./Yarns.module.css";

interface Props {
  yarn: YarnItem | null;
  /** Подставить название заранее — при создании из подсказки, где ничего не нашлось. */
  initialName?: string;
  onClose: () => void;
  onSave: (data: Partial<YarnItem>) => void;
}

/**
 * Форма карточки артикула. Поля оставлены минимально необходимые:
 *
 * - Бренд (обязателен, если не родовая карточка) — с autocomplete по существующим
 * - Линейка (обязательна) — с autocomplete по существующим
 * - Родовое название (только для админа)
 * - Метраж м/100г (обязателен)
 * - Плотность производителя (необязательна)
 * - Состав (необязателен)
 *
 * Имя артикула формируется на бэкенде из бренда + линейки, поэтому поле
 * «Название» убрано: дублирует пару Бренд/Линейка и провоцирует опечатки.
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

  const set = (k: keyof typeof form, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Числовые поля живут в форме строками — иначе поле нельзя очистить, не
  // проходя через NaN. Пустая строка → null: «метраж неизвестен» ≠ «метраж 0».
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const payload = (): Partial<YarnItem> => {
    const brand = form.brand.trim() || null;
    const line = form.line.trim() || null;
    // Имя = «Бренд Линейка» или только одно из них если второго нет.
    const nameParts = [brand, line].filter(Boolean);
    const name = nameParts.join(" ") || yarn?.name || "";
    return {
      name,
      brand,
      line,
      isGeneric: form.isGeneric,
      mPer100g: num(form.mPer100g),
      densityRaw: form.densityRaw.trim() || null,
      composition: form.composition.trim() || null,
    };
  };

  // Валидация: бренд обязателен (кроме родовых карточек), линейка обязательна,
  // метраж обязателен.
  const isValid =
    (form.isGeneric || form.brand.trim() !== "") &&
    form.line.trim() !== "" &&
    form.mPer100g.trim() !== "" &&
    form.composition.trim() !== "";

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

        {/* Линейка — autocomplete */}
        <AutocompleteField
          label="Линейка"
          value={form.line}
          onChange={(v) => set("line", v)}
          fetchSuggestions={getYarnLines}
          placeholder="Angora Gold, Loves You…"
          required
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

        {/* Метраж — обязательное поле */}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Метраж, м/100 г *</span>
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

        {/* Состав — необязательное, на всю ширину */}
        <label className={styles.fieldWide}>
          <span className={styles.fieldLabel}>Состав *</span>
          <input
            className={styles.fieldInput}
            value={form.composition}
            placeholder="100% акрил; 80% шерсть, 20% полиамид…"
            onChange={(e) => set("composition", e.target.value)}
          />
        </label>
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
