import React from "react";
import { DictionaryItem } from "../../api/patterns";

export const MAX_CATEGORIES = 2;
export const MAX_TAGS = 4;

export const labelStyle: React.CSSProperties = { fontFamily: "Mulish", fontSize: 15, fontWeight: 400, color: "var(--text)" };
export const optionalStyle: React.CSSProperties = { color: "var(--text-placeholder)", fontSize: 13 };
export const inputStyle: React.CSSProperties = {
  width: "100%", height: 45, padding: "12px 16px",
  background: "var(--surface-gray)", border: "none", borderRadius: 2,
  fontFamily: "Mulish", fontSize: 15, color: "var(--text)", boxSizing: "border-box",
};
export const selectStyles = {
  control: (base: any) => ({ ...base, minHeight: 45, background: "var(--surface-gray)", border: "none", borderRadius: 2, boxShadow: "none", fontFamily: "Mulish", fontSize: 15, cursor: "pointer" }),
  valueContainer: (base: any) => ({ ...base, padding: "0 15px" }),
  placeholder: (base: any) => ({ ...base, color: "var(--text-placeholder)" }),
  menu: (base: any) => ({ ...base, fontFamily: "Mulish", fontSize: 15 }),
};
export const btnStyle = (bg: string, color: string): React.CSSProperties => ({
  height: 32, padding: "0 12px", display: "flex", alignItems: "center", justifyContent: "center",
  background: bg, color, border: "none", borderRadius: 2, fontFamily: "Mulish", fontSize: 12,
  cursor: "pointer", whiteSpace: "nowrap",
});

export function ModalCheckbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, flexShrink: 0 }}
      >
        {checked ? (
          <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 16L14.6667 18.6667L20 13.3333M6.66667 4H25.3333C26.8061 4 28 5.19391 28 6.66667V25.3333C28 26.8061 26.8061 28 25.3333 28H6.66667C5.19391 28 4 26.8061 4 25.3333V6.66667C4 5.19391 5.19391 4 6.66667 4Z" stroke="#1D1C1C" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M25.3333 4H6.66667C5.19391 4 4 5.19391 4 6.66667V25.3333C4 26.8061 5.19391 28 6.66667 28H25.3333C26.8061 28 28 26.8061 28 25.3333V6.66667C28 5.19391 26.8061 4 25.3333 4Z" stroke="#1D1C1C" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <span
        onClick={() => onChange(!checked)}
        style={{ fontFamily: "Mulish", fontSize: 15, color: "var(--text)", cursor: "pointer", userSelect: "none" }}
      >
        {label}
      </span>
    </>
  );
}

export function mapNamesToIds(names: string[], list: DictionaryItem[]): string[] {
  return names
    .map((name) => list.find((x) => x.name === name)?.id)
    .filter((id): id is string => !!id);
}
