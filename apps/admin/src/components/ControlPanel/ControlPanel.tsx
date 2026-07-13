import { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./ControlPanel.module.css";

export interface ControlPanelTab {
  value: string;
  label: string;
  prefix?: ReactNode;
  prefixColor?: string;
  count?: number;
}

interface ControlPanelProps {
  tabs?: ControlPanelTab[];
  activeTab?: string;
  onTabChange?: (value: string) => void;
  actions?: ReactNode;
}

export function ControlPanel({ tabs, activeTab, onTabChange, actions }: ControlPanelProps) {
  return (
    <div className={styles.panel}>
      {tabs && (
        <div className={styles.tabs}>
          {tabs.map((tab) => (
            <button
              key={tab.value}
              className={`${styles.tab} ${activeTab === tab.value ? styles.tabActive : ""}`}
              onClick={() => onTabChange?.(tab.value)}
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
      )}
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}

const VARIANT_CLASS: Record<"add" | "neutral" | "danger", string> = {
  add: styles.btnAdd,
  neutral: styles.btnNeutral,
  danger: styles.btnDanger,
};

interface ControlPanelBtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: "add" | "neutral" | "danger";
  icon?: ReactNode;
}

export function ControlPanelBtn({ variant, icon, children, className, ...props }: ControlPanelBtnProps) {
  return (
    <button
      className={[styles.btn, VARIANT_CLASS[variant], className].filter(Boolean).join(" ")}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
