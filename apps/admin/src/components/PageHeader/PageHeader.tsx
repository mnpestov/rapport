import { Search, X } from "lucide-react";
import styles from "./PageHeader.module.css";

interface PageHeaderProps {
  title: string;
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  totalCount?: {
    label: string;
    value: number | null;
  };
}

export function PageHeader({ title, search, totalCount }: PageHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.left}>
        <h1 className={styles.title}>{title}</h1>
        {search && (
          <div className={styles.search}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder={search.placeholder ?? "Поиск"}
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
            />
            <div className={styles.searchIcons}>
              {search.value && (
                <button className={styles.clearBtn} onClick={() => search.onChange("")}>
                  <X size={16} strokeWidth={1} />
                </button>
              )}
              <Search size={24} strokeWidth={1} color="#9b9a9a" />
            </div>
          </div>
        )}
      </div>

      {totalCount && totalCount.value !== null && (
        <div className={styles.count}>
          <span className={styles.countLabel}>{totalCount.label}</span>
          <span className={styles.countValue}>{totalCount.value}</span>
        </div>
      )}
    </div>
  );
}
