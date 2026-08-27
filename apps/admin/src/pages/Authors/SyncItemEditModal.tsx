import React, { useEffect, useState } from "react";
import { YarnPicker, PickedYarn } from "../../components/YarnPicker/YarnPicker";
import CreatableSelect from "react-select/creatable";
import toast from "react-hot-toast";
import { Modal } from "../../components/Modal/Modal";
import { ImageGalleryManager } from "../../components/ImageGalleryManager/ImageGalleryManager";
import { getCategories, getTags, getInstruments, getYarnRanges, DictionaryItem, YarnRange } from "../../api/patterns";
import { SyncReportItem, updateSyncItem, SyncItemUpdateDTO } from "../../api/authors";
import { AdminDraft } from "../../api/admin-drafts";
import { MAX_CATEGORIES, MAX_TAGS, labelStyle, optionalStyle, inputStyle, selectStyles, btnStyle, ModalCheckbox } from "../Patterns/formShared";
import patternsStyles from "../Patterns/Patterns.module.css";

interface SyncItemEditModalProps {
  isOpen: boolean;
  item: AdminDraft | null;
  onClose: () => void;
  onSaved: (updated: SyncReportItem) => void;
}

interface FormState {
  title: string;
  url: string;
  images: string[];
  details: string;
  price: string;
  oldPrice: string;
  isFree: boolean;
  isNew: boolean;
  categories: string[];
  tags: string[];
  instruments: string[];
  yarnRangeIds: string[];
  yarns: PickedYarn[];
  densityStitches: string;
  densityRows: string;
}

function toFormState(item: AdminDraft): FormState {
  return {
    title: item.title || "",
    url: item.url || "",
    // Freshly scraped drafts can carry more than the 5-photo save limit —
    // trim on load so what's shown matches what a save will persist.
    images: item.images.slice(0, 5),
    details: item.details || "",
    price: item.price != null ? String(item.price) : "",
    oldPrice: item.oldPrice != null ? String(item.oldPrice) : "",
    isFree: item.isFree ?? false,
    isNew: item.isNew ?? true,
    categories: item.categories.map((c) => c.name),
    tags: item.tags.map((t) => t.name),
    instruments: item.instruments.map((i) => i.name),
    yarnRangeIds: item.yarnRanges.map((y) => y.id),
    // Артикулы у новинки лежат в parsedData: описания в Pattern ещё нет, и
    // вешать связь не на что. Резолв случится при одобрении.
    yarns: (item.yarns || []).map((y) => ({ id: y.id, name: y.name, mPer100g: null, composition: null })),
    densityStitches: item.densityStitches != null ? String(item.densityStitches) : "",
    densityRows: item.densityRows != null ? String(item.densityRows) : "",
  };
}

export function SyncItemEditModal({ isOpen, item, onClose, onSaved }: SyncItemEditModalProps) {
  const [formData, setFormData] = useState<FormState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [categoriesList, setCategoriesList] = useState<DictionaryItem[]>([]);
  const [tagsList, setTagsList] = useState<DictionaryItem[]>([]);
  const [instrumentsList, setInstrumentsList] = useState<DictionaryItem[]>([]);
  const [yarnRangesList, setYarnRangesList] = useState<YarnRange[]>([]);

  useEffect(() => {
    if (isOpen && item) {
      setFormData(toFormState(item));
    }
  }, [isOpen, item]);

  useEffect(() => {
    if (!isOpen) return;
    Promise.all([getCategories(), getTags(), getInstruments(), getYarnRanges()])
      .then(([c, t, i, y]) => {
        setCategoriesList(c);
        setTagsList(t);
        setInstrumentsList(i);
        setYarnRangesList(y);
      })
      .catch(() => toast.error("Не удалось загрузить справочники"));
  }, [isOpen]);

  if (!isOpen || !item || !formData) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.url || formData.images.length === 0) {
      toast.error("Пожалуйста, заполните все обязательные поля");
      return;
    }

    try {
      setIsSaving(true);
      const payload: SyncItemUpdateDTO = {
        title: formData.title.trim(),
        url: formData.url.trim(),
        images: formData.images,
        details: formData.details.trim() || null,
        price: formData.price.trim() || null,
        oldPrice: formData.oldPrice.trim() || null,
        isFree: formData.isFree,
        isNew: formData.isNew,
        categories: formData.categories,
        tags: formData.tags,
        instruments: formData.instruments,
        yarnRangeIds: formData.yarnRangeIds,
        yarns: formData.yarns.map((y) => ({ id: y.id })),
        densityStitches: formData.densityStitches.trim(),
        densityRows: formData.densityRows.trim(),
      };
      const updated = await updateSyncItem(item.id, payload);
      toast.success("Сохранено");
      onSaved(updated);
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Не удалось сохранить изменения");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Редактировать новинку" maxWidth={760}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 30 }}>
        <div className={patternsStyles.formGrid}>

          {/* Название */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={labelStyle}>Название <span style={{ color: "var(--danger)" }}>*</span></label>
            <input
              type="text"
              value={formData.title}
              onChange={e => setFormData({ ...formData, title: e.target.value })}
              style={inputStyle}
              placeholder="Название"
              required
            />
          </div>

          {/* Категория */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={labelStyle}>Категория <span style={optionalStyle}></span></label>
            <CreatableSelect
              isMulti
              isOptionDisabled={() => formData.categories.length >= MAX_CATEGORIES}
              styles={selectStyles}
              options={categoriesList.map(c => ({ value: c.name, label: c.name }))}
              value={formData.categories.map(c => ({ value: c, label: c }))}
              onChange={(vals: any) => {
                if (vals.length > MAX_CATEGORIES) {
                  toast.error(`Не более ${MAX_CATEGORIES} категорий`);
                  return;
                }
                setFormData({ ...formData, categories: vals.map((v: any) => v.value) });
              }}
              placeholder="Категории"
            />
          </div>

          {/* Новинка */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <ModalCheckbox checked={formData.isNew} onChange={v => setFormData({ ...formData, isNew: v })} label="Новинка" />
          </div>

          {/* Бесплатное */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <ModalCheckbox checked={formData.isFree} onChange={v => setFormData({ ...formData, isFree: v })} label="Бесплатное" />
          </div>

          {/* Характеристики */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={labelStyle}>Характеристики <span style={optionalStyle}></span></label>
            <CreatableSelect
              isMulti
              isOptionDisabled={() => formData.tags.length >= MAX_TAGS}
              styles={selectStyles}
              options={tagsList.map(t => ({ value: t.name, label: t.name }))}
              value={formData.tags.map(t => ({ value: t, label: t }))}
              onChange={(vals: any) => {
                if (vals.length > MAX_TAGS) {
                  toast.error(`Не более ${MAX_TAGS} характеристик`);
                  return;
                }
                setFormData({ ...formData, tags: vals.map((v: any) => v.value) });
              }}
              placeholder="Характеристики"
            />
          </div>

          {/* Ссылка */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={labelStyle}>Ссылка <span style={{ color: "var(--danger)" }}>*</span></label>
            <input
              type="url"
              value={formData.url}
              onChange={e => setFormData({ ...formData, url: e.target.value })}
              style={inputStyle}
              placeholder="Вставить ссылку"
              required
            />
          </div>

          {/* Инструмент */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={labelStyle}>Инструмент <span style={optionalStyle}></span></label>
            <CreatableSelect
              isMulti
              styles={selectStyles}
              options={instrumentsList.map(i => ({ value: i.name, label: i.name }))}
              value={formData.instruments.map(i => ({ value: i, label: i }))}
              onChange={(vals: any) => setFormData({ ...formData, instruments: vals.map((v: any) => v.value) })}
              placeholder="Инструмент"
            />
          </div>

          {/* Толщина пряжи */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={labelStyle}>Толщина пряжи (м/100г) <span style={optionalStyle}>(необязательно)</span></label>
            <CreatableSelect
              isMulti
              isValidNewOption={() => false}
              styles={selectStyles}
              options={yarnRangesList.map(y => ({ value: y.id, label: y.label }))}
              value={yarnRangesList
                .filter(y => formData.yarnRangeIds.includes(y.id))
                .map(y => ({ value: y.id, label: y.label }))}
              onChange={(vals: any) => setFormData({ ...formData, yarnRangeIds: vals.map((v: any) => v.value) })}
              placeholder="Диапазон толщины"
            />
          </div>

          {/* Артикулы пряжи. Тот же контрол, что в форме описания, но
              сохраняется иначе: описания в Pattern ещё нет, поэтому выбор
              лежит в parsedData и превращается в связи при одобрении. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={labelStyle}>Пряжа <span style={optionalStyle}>(необязательно)</span></label>
            <YarnPicker
              value={formData.yarns}
              onChange={(yarns) => setFormData({ ...formData, yarns })}
            />
          </div>

          {/* Плотность */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={labelStyle}>Плотность (петли × ряды) в лицевой глади <span style={optionalStyle}></span></label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="number"
                value={formData.densityStitches}
                onChange={e => setFormData({ ...formData, densityStitches: e.target.value })}
                style={{ ...inputStyle, width: "calc(50% - 16px)" }}
                min={0}
                step="any"
              />
              <span style={{ fontFamily: "Mulish", fontSize: 14, color: "var(--text)", flexShrink: 0 }}>×</span>
              <input
                type="number"
                value={formData.densityRows}
                onChange={e => setFormData({ ...formData, densityRows: e.target.value })}
                style={{ ...inputStyle, width: "calc(50% - 16px)" }}
                min={0}
                step="any"
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <span style={{ width: "calc(50% - 16px)", fontFamily: "Mulish", fontSize: 12, color: "var(--text-placeholder)" }}>Петли</span>
              <span style={{ width: 16 }} />
              <span style={{ width: "calc(50% - 16px)", fontFamily: "Mulish", fontSize: 12, color: "var(--text-placeholder)" }}>Ряды</span>
            </div>
          </div>

          {/* Цена / старая цена — oldPrice заполнена только когда реально есть скидка */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={labelStyle}>Цена, ₽ <span style={optionalStyle}>(необязательно)</span></label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="number"
                value={formData.price}
                onChange={e => setFormData({ ...formData, price: e.target.value })}
                style={{ ...inputStyle, width: "calc(50% - 16px)" }}
                min={0}
              />
              <span style={{ width: 8, flexShrink: 0 }} />
              <input
                type="number"
                value={formData.oldPrice}
                onChange={e => setFormData({ ...formData, oldPrice: e.target.value })}
                style={{ ...inputStyle, width: "calc(50% - 16px)" }}
                min={0}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <span style={{ width: "calc(50% - 16px)", fontFamily: "Mulish", fontSize: 12, color: "var(--text-placeholder)" }}>Текущая</span>
              <span style={{ width: 16 }} />
              <span style={{ width: "calc(50% - 16px)", fontFamily: "Mulish", fontSize: 12, color: "var(--text-placeholder)" }}>Старая (если скидка)</span>
            </div>
          </div>

          {/* Фото (до 5, первое — обложка) */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={labelStyle}>Фото <span style={{ color: "var(--danger)" }}>*</span></label>
            <ImageGalleryManager
              images={formData.images}
              onChange={(images) => setFormData({ ...formData, images })}
            />
          </div>

          {/* Подробности — длинный текст, во всю ширину формы */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Подробности <span style={optionalStyle}>(необязательно)</span></label>
            <textarea
              value={formData.details}
              onChange={e => setFormData({ ...formData, details: e.target.value })}
              style={{ ...inputStyle, height: 160, resize: "vertical", paddingTop: 12, paddingBottom: 12 }}
              placeholder="Подробное описание — материалы, техника, размеры и т.п."
            />
          </div>

        </div>

        {/* Кнопки */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 20 }}>
          <button type="button" onClick={onClose} style={btnStyle("var(--surface-gray)", "var(--text)")}>
            Закрыть
          </button>
          <button type="submit" disabled={isSaving} style={btnStyle("var(--brand-bright)", "var(--surface)")}>
            {isSaving ? "Сохранение..." : "Сохранить"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
