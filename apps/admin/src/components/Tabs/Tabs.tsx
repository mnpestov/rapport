import { ReactNode, useState, useEffect } from "react";
import styles from "./Tabs.module.css";

export interface Tab {
  value: string;
  label: string;
  prefix?: ReactNode;
  prefixColor?: string;
  count?: number;
}

interface TabsProps {
  tabs: Tab[];
  value?: string;
  onChange?: (value: string) => void;
  /** Подпись для выпадающего списка на телефоне — там вкладки не видны. */
  mobileLabel?: string;
}

/**
 * Вкладки, которые на узком экране становятся выпадающим списком.
 *
 * Порог в 768 px и переключение по `resize` — как было в ControlPanel.
 * Считать ширину при каждом рендере нельзя: значение нужно и на первом,
 * до того как сработает обработчик.
 */
export function Tabs({ tabs, value, onChange, mobileLabel }: TabsProps) {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (isMobile) {
    return (
      <select
        className={styles.mobileSelect}
        value={value}
        aria-label={mobileLabel}
        onChange={(e) => onChange?.(e.target.value)}
      >
        {tabs.map((tab) => (
          <option key={tab.value} value={tab.value}>
            {tab.label} {tab.count !== undefined ? `(${tab.count})` : ""}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className={styles.tabs} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          className={`${styles.tab} ${value === tab.value ? styles.tabActive : ""}`}
          onClick={() => onChange?.(tab.value)}
        >
          {tab.prefix && (
            <span
              className={styles.tabPrefix}
              style={tab.prefixColor ? { background: tab.prefixColor } : undefined}
            >
              {tab.prefix}
            </span>
          )}
          {tab.label}
          {tab.count !== undefined && <span className={styles.badge}>{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
