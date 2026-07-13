import { NavLink, useNavigate } from "react-router-dom";
import { LayoutList, UserRound, ChartColumnStacked, MessageCircleCheck, FileUser, BookUser, Info, LogOut, BarChart2 } from "lucide-react";
import styles from "./Sidebar.module.css";
import { useUnread } from "../../contexts/UnreadContext";
import { useAuth } from "../../contexts/AuthContext";
import { logout } from "../../api/auth";

interface SidebarProps {
  variant?: "admin" | "author";
  subtitle?: string;
}

export function Sidebar({ variant = "admin", subtitle }: SidebarProps) {
  const navigate = useNavigate();
  const { whitelistTotal, allTotal } = useUnread();
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
    <aside className={styles.sidebar}>
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
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.active : ""}`
              }
            >
              <UserRound size={24} strokeWidth={1} className={styles.icon} />
              <span className={styles.label}>Авторы</span>
            </NavLink>

            <NavLink
              to="/stats"
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.active : ""}`
              }
            >
              <ChartColumnStacked size={24} strokeWidth={1} className={styles.icon} />
              <span className={styles.label}>Статистика</span>
            </NavLink>

            <NavLink
              to="/requests"
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
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.active : ""}`
              }
            >
              <FileUser size={24} strokeWidth={1} className={styles.icon} />
              <span className={styles.label}>Белый список</span>
              {whitelistTotal > 0 && <span className={styles.badge}>{whitelistTotal}</span>}
            </NavLink>

            <NavLink
              to="/users"
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.active : ""}`
              }
            >
              <BookUser size={24} strokeWidth={1} className={styles.icon} />
              <span className={styles.label}>Пользователи</span>
            </NavLink>

            <NavLink
              to="/dictionaries"
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.active : ""}`
              }
            >
              <Info size={24} strokeWidth={1} className={styles.icon} />
              <span className={styles.label}>Справочник</span>
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
  );
}
