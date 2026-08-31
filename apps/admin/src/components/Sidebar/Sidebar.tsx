import { NavLink, useNavigate } from "react-router-dom";
import { LayoutList, UserRound, ChartColumnStacked, MessageCircleCheck, FileUser, BookUser, Info, LogOut, BarChart2, BookMarked, ReceiptText, X, Spool, UserPlus } from "lucide-react";
import styles from "./Sidebar.module.css";
import { useUnread } from "../../contexts/UnreadContext";
import { useAuth } from "../../contexts/AuthContext";
import { logout } from "../../api/auth";


interface SidebarProps {
  variant?: "admin" | "author";
  subtitle?: string;
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ variant = "admin", subtitle, isOpen, onClose }: SidebarProps) {
  const navigate = useNavigate();
  const { whitelistTotal, allTotal, syncReportsCount, pendingApplicationsCount, pendingYarnsCount } = useUnread();
  const { clearToken } = useAuth();

  const handleLogout = async () => {
    await logout();
    clearToken();
    try {
      const bc = new BroadcastChannel("auth_channel");
      bc.postMessage({ type: "LOGOUT" });
      bc.close();
    } catch {
      // BroadcastChannel not available
    }
    navigate("/login");
  };

  return (
    <>
      {isOpen && <div className={styles.overlay} onClick={onClose} />}
      <aside className={`${styles.sidebar} ${isOpen ? styles.open : ""}`}>
        {onClose && (
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={24} strokeWidth={1} color="#1d1c1c" />
          </button>
        )}
        <div className={styles.logoContainer}>
          <img src="/logo-dark.svg" alt="Rapport" className={styles.logoImage} />
        </div>

      {subtitle && <div className={styles.subtitle}>
        <span className="author-name">{subtitle}</span>
      </div>}

      <nav className={styles.nav}>
        {variant === "admin" ? (
          <NavLink
            to="/patterns"
            onClick={onClose}
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.active : ""}`
            }
          >
            <LayoutList size={24} strokeWidth={1} className={styles.icon} />
            <span className={styles.label}>Описания</span>
          </NavLink>
        ) : (
          <NavLink
            to="/cabinet"
            end
            onClick={onClose}
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.active : ""}`
            }
          >
            <LayoutList size={24} strokeWidth={1} className={styles.icon} />
            <span className={styles.label}>Описания</span>
          </NavLink>
        )}

        {variant === "admin" && (
          <>
            <NavLink
              to="/authors"
              onClick={onClose}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.active : ""}`
              }
            >
              <UserRound size={24} strokeWidth={1} className={styles.icon} />
              <span className={styles.label}>Авторы</span>
              {syncReportsCount > 0 && <span className={styles.badge}>{syncReportsCount}</span>}
            </NavLink>

            <NavLink
              to="/stats"
              onClick={onClose}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.active : ""}`
              }
            >
              <ChartColumnStacked size={24} strokeWidth={1} className={styles.icon} />
              <span className={styles.label}>Статистика</span>
            </NavLink>

            <NavLink
              to="/requests"
              onClick={onClose}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.active : ""}`
              }
            >
              <MessageCircleCheck size={24} strokeWidth={1} className={styles.icon} />
              <span className={styles.label}>Обращения</span>
              {allTotal > 0 && <span className={styles.badge}>{allTotal}</span>}
            </NavLink>

            <NavLink
              to="/whitelist"
              onClick={onClose}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.active : ""}`
              }
            >
              <FileUser size={24} strokeWidth={1} className={styles.icon} />
              <span className={styles.label}>Белый список</span>
              {whitelistTotal > 0 && <span className={styles.badge}>{whitelistTotal}</span>}
            </NavLink>

            <NavLink
              to="/author-applications"
              onClick={onClose}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.active : ""}`
              }
            >
              <UserPlus size={24} strokeWidth={1} className={styles.icon} />
              <span className={styles.label}>Заявки авторов</span>
              {pendingApplicationsCount > 0 && <span className={styles.badge}>{pendingApplicationsCount}</span>}
            </NavLink>

            <NavLink
              to="/users"
              onClick={onClose}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.active : ""}`
              }
            >
              <BookUser size={24} strokeWidth={1} className={styles.icon} />
              <span className={styles.label}>Пользователи</span>
            </NavLink>

            <NavLink
              to="/payments"
              onClick={onClose}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.active : ""}`
              }
            >
              <ReceiptText size={24} strokeWidth={1} className={styles.icon} />
              <span className={styles.label}>Счета</span>
            </NavLink>

            <NavLink
              to="/price-check"
              onClick={onClose}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.active : ""}`
              }
            >
              <Info size={24} strokeWidth={1} className={styles.icon} />
              <span className={styles.label}>Скрипт цен</span>
            </NavLink>

            <NavLink
              to="/dictionaries"
              onClick={onClose}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.active : ""}`
              }
            >
              <BookMarked size={24} strokeWidth={1} className={styles.icon} />
              <span className={styles.label}>Справочники</span>
            </NavLink>

            {/* Артикулы вынесены отдельным пунктом, а не вкладкой в
                «Справочниках»: там три списка по несколько десятков строк с
                общим устройством, здесь 2778 карточек со своим поиском,
                страницами и слиянием дублей. */}
            <NavLink
              to="/yarns"
              onClick={onClose}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.active : ""}`
              }
            >
              <Spool size={24} strokeWidth={1} className={styles.icon} />
              <span className={styles.label}>Артикулы пряжи</span>
              {pendingYarnsCount > 0 && <span className={styles.badge}>{pendingYarnsCount}</span>}
            </NavLink>
          </>
        )}

        {variant === "author" && (
          <>
            <span className={styles.navItem} aria-disabled="true">
              <UserRound size={24} strokeWidth={1} className={styles.icon} />
              <span className={styles.label}>Профиль</span>
              <span className={styles.soon}>скоро</span>
            </span>

            <span className={styles.navItem} aria-disabled="true">
              <BarChart2 size={24} strokeWidth={1} className={styles.icon} />
              <span className={styles.label}>Статистика</span>
              <span className={styles.soon}>скоро</span>
            </span>
          </>
        )}
      </nav>

      <button className={styles.logoutBtn} onClick={handleLogout}>
        <LogOut size={24} strokeWidth={1} className={styles.icon} />
        <span className={styles.label}>Выйти</span>
      </button>
      </aside>
    </>
  );
}
