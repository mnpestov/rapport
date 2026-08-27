import { ReactNode } from "react";
import { List, LayoutGrid } from "lucide-react";
import { Tabs, Tab } from "../Tabs/Tabs";
import styles from "./ControlPanel.module.css";

/** Оставлено для совместимости: раньше тип вкладки жил здесь. */
export type ControlPanelTab = Tab;

interface ControlPanelProps {
  tabs?: ControlPanelTab[];
  activeTab?: string;
  onTabChange?: (value: string) => void;
  actions?: ReactNode;
}

export function ControlPanel({ tabs, activeTab, onTabChange, actions }: ControlPanelProps) {
  return (
    <div className={styles.panel}>
      {tabs && <Tabs tabs={tabs} value={activeTab} onChange={onTabChange} />}
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}

export type ViewMode = "list" | "grid";

interface ViewToggleProps {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
}

export function ViewToggle({ value, onChange }: ViewToggleProps) {
  return (
    <div className={styles.viewToggle}>
      <button
        type="button"
        title="Списком"
        className={`${styles.viewToggleBtn} ${value === "list" ? styles.viewToggleBtnActive : ""}`}
        onClick={() => onChange("list")}
      >
        <List size={18} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        title="Карточками"
        className={`${styles.viewToggleBtn} ${value === "grid" ? styles.viewToggleBtnActive : ""}`}
        onClick={() => onChange("grid")}
      >
        <LayoutGrid size={18} strokeWidth={1.5} />
      </button>
    </div>
  );
}
