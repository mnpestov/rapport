import { useState } from "react";
import { X } from "lucide-react";
import { YarnItem } from "../../api/yarns";
import styles from "./Yarns.module.css";

interface Props {
  yarn: YarnItem | null;
  /** Подставить название заранее — при создании из подсказки, где ничего не нашлось. */
  initialName?: string;
  onClose: () => void;
  onSave: (data: Partial<YarnItem>) => void;
}

/**
 * Форма карточки артикула. Обязательное здесь только название; всё
 * остальное необязательно осознанно — у трети справочника характеристик нет
 * вовсе, и требовать их значило бы не дать завести карточку под пряжу,
 * которую автор упомянул, а магазин ещё не описал.
 *
 * Бренд обязателен, только если карточка не родовая: у «Пуха норки» марки
 * нет и быть не может.
 */
export function YarnEditModal({ yarn, initialName, onClose, onSave }: Props) {
  const [form, setForm] = useState({
    name: yarn?.name ?? initialName ?? "",
    brand: yarn?.brand ?? "",
    line: yarn?.line ?? "",
    isGeneric: yarn?.isGeneric ?? false,
    mPer100g: yarn?.mPer100g?.toString() ?? "",
    composition: yarn?.composition ?? "",
    needleSizeRaw: yarn?.needleSizeRaw ?? "",
    densityRaw: yarn?.densityRaw ?? "",
    ballWeightG: yarn?.ballWeightG?.toString() ?? "",
    ballLengthM: yarn?.ballLengthM?.toString() ?? "",
    sourceName: yarn?.sourceName ?? "",
    sourceUrl: yarn?.sourceUrl ?? "",
  });
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  // Числовые поля живут в форме строками — иначе поле нельзя очистить, не
  // проходя через NaN. Приводим один раз, на отправке; пустая строка должна
  // стать null, а не нулём: «метраж неизвестен» и «метраж 0» — разное.
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const payload = (): Partial<YarnItem> => ({
    name: form.name.trim(),
    brand: form.brand.trim() || null,
    line: form.line.trim() || null,
    isGeneric: form.isGeneric,
    mPer100g: num(form.mPer100g),
    composition: form.composition.trim() || null,
    needleSizeRaw: form.needleSizeRaw.trim() || null,
    densityRaw: form.densityRaw.trim() || null,
    ballWeightG: num(form.ballWeightG),
    ballLengthM: num(form.ballLengthM),
    sourceName: form.sourceName.trim() || null,
    sourceUrl: form.sourceUrl.trim() || null,
  });

  const field = (label: string, k: keyof typeof form, placeholder = "", wide = false) => (
    <label className={wide ? styles.fieldWide : styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <input
        className={styles.fieldInput}
        value={form[k] as string}
        placeholder={placeholder}
        onChange={(e) => set(k, e.target.value)}
      />
    </label>
  );

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <h2>{yarn ? "Артикул" : "Новый артикул"}</h2>
          <button type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className={styles.form}>
          {field("Название", "name", "Бренд и линейка целиком", true)}
          {field("Бренд", "brand")}
          {field("Линейка", "line")}
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
          {field("Метраж, м/100 г", "mPer100g", "например, 350")}
          {field("Вес мотка, г", "ballWeightG")}
          {field("Длина мотка, м", "ballLengthM")}
          {field("Спицы", "needleSizeRaw", "4,5—5 мм")}
          {field("Плотность", "densityRaw", "22 п. × 30 р.")}
          {field("Состав", "composition", "", true)}
          {field("Источник", "sourceName", "", true)}
          {field("Ссылка на источник", "sourceUrl", "", true)}
        </div>

        <div className={styles.modalFoot}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className={styles.saveBtn}
            disabled={!form.name.trim()}
            onClick={() => onSave(payload())}
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
