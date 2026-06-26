import { NavLink, useNavigate } from "react-router-dom";
import { FileText, TrendingUp, Users, LogOut, ShieldCheck } from "lucide-react";
import styles from "./Sidebar.module.css";

export function Sidebar() {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem("jwt_token");
    navigate("/login");
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logoContainer}>
        <img src="/logo-dark.svg" alt="Rapport" className={styles.logoImage} />
      </div>

      <nav className={styles.nav}>
        <NavLink
          to="/patterns"
          className={({ isActive }) =>
            `${styles.navItem} ${isActive ? styles.active : ""}`
          }
        >
          <FileText size={20} className={styles.icon} />
          <span className={styles.label}>Описания</span>
        </NavLink>

        <NavLink
          to="/authors"
          className={({ isActive }) =>
            `${styles.navItem} ${isActive ? styles.active : ""}`
          }
        >
          <Users size={20} className={styles.icon} />
          <span className={styles.label}>Авторы</span>
        </NavLink>

        <NavLink
          to="/stats"
          className={({ isActive }) =>
            `${styles.navItem} ${isActive ? styles.active : ""}`
          }
        >
          <TrendingUp size={20} className={styles.icon} />
          <span className={styles.label}>Статистика</span>
        </NavLink>

        <NavLink
          to="/whitelist"
          className={({ isActive }) =>
            `${styles.navItem} ${isActive ? styles.active : ""}`
          }
        >
          <ShieldCheck size={20} className={styles.icon} />
          <span className={styles.label}>Белый список</span>
        </NavLink>
      </nav>

      <button className={styles.logoutBtn} onClick={handleLogout}>
        <LogOut size={20} className={styles.icon} />
        <span className={styles.label}>Выйти</span>
      </button>
    </aside>
  );
}
