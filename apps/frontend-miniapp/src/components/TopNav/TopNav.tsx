import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import logo from '../../assets/paywall/rapport-logo-black.svg';
import './TopNav.css';

// Десктопный аналог TabBar.tsx (Figma node-id=1651:21630/1700:22637) — та
// же разметка разделов (4 пункта, те же пути), но горизонтальная строка
// текстовых ссылок вместо нижних иконок. Намеренно НЕ переиспользует TABS
// из TabBar.tsx напрямую: там массив завязан на пары иконок active/inactive,
// которых здесь нет и не будет (десктоп — просто текст, жирный для
// активного пункта). Список путей/лейблов пришлось бы всё равно продублировать,
// иконки тащить незачем.
//
// Видимость целиком (есть ли смысл её вообще показывать) и прятанье
// TabBar.tsx на десктопе — на стороне App.tsx/TabBar.tsx соответственно,
// этот компонент сам ничего не знает о разрешениях (тот же принцип, что у
// TabBar).
const NAV_LINKS = [
  { path: '/', label: 'Описания' },
  { path: '/stash', label: 'Пряжа' },
  { path: '/projects', label: 'Проекты' },
  { path: '/favorites', label: 'Избранное' },
] as const;

export const TopNav: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="top-nav" role="navigation" aria-label="Основная навигация">
      {/* max-width:1440px + margin:auto повторяет .stash-container (Stash.css) —
          иначе на широких экранах (>1540px) логотип/ссылки упираются в
          плоский padding:50px от края вьюпорта, а контент страницы уже
          центрирован колонкой уже этой ширины — края расходятся. */}
      <div className="top-nav-inner">
        <button type="button" className="top-nav-logo-btn" onClick={() => navigate('/')} aria-label="Раппорт">
          <img src={logo} alt="Раппорт" className="top-nav-logo" />
        </button>
        <div className="top-nav-links">
          {NAV_LINKS.map((link) => {
            // Раздел остаётся активным и на вложенных страницах (карточка
            // пряжи /stash/:id, карточка проекта /projects/:id) — простое
            // равенство путей их не ловило. "/" — особый случай, иначе он
            // совпадал бы префиксом с любым путём.
            const isActive = link.path === '/'
              ? location.pathname === '/'
              : location.pathname === link.path || location.pathname.startsWith(`${link.path}/`);
            return (
              <button
                key={link.path}
                type="button"
                className={`top-nav-link${isActive ? ' top-nav-link--active' : ''}`}
                // Без guard'а на isActive: повторный клик на уже активный
                // раздел (в т.ч. с вложенной страницы вроде /stash/:id)
                // должен возвращать на корень раздела, а не быть no-op.
                onClick={() => navigate(link.path)}
                aria-current={isActive ? 'page' : undefined}
              >
                {link.label}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
};
