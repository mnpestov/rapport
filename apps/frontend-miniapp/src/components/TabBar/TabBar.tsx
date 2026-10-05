import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import catalogActive from './icons/catalog-active.svg';
import catalogInactive from './icons/catalog-inactive.svg';
import yarnActive from './icons/yarn-active.svg';
import yarnInactive from './icons/yarn-inactive.svg';
import projectsActive from './icons/projects-active.svg';
import projectsInactive from './icons/projects-inactive.svg';
import favoritesActive from './icons/favorites-active.svg';
import favoritesInactive from './icons/favorites-inactive.svg';
import './TabBar.css';

// Разделы мини-аппа (YARN_STASH_PLAN.md T18, обновлено под 4-пунктный
// таб-бар, Figma node-id=1348:11592; «Проекты» стала реальным пунктом в
// PROJECTS_PLAN.md T4.3). Показывается ТОЛЬКО на путях из TABS с маршрутом —
// скрыт на внутренних экранах (карточка описания, карточка пряжи/проекта,
// формы), где навигация назад остаётся прежней стрелкой «Назад» в шапке.
// Гейтинг самого факта рендера (весь таб-бар целиком) — на вызывающей
// стороне (App.tsx, по isStashTestingAccess/usePremiumAccess), не здесь:
// этот компонент ничего не знает о разрешениях.
const TABS = [
  { path: '/', label: 'Описания', active: catalogActive, inactive: catalogInactive },
  { path: '/stash', label: 'Пряжа', active: yarnActive, inactive: yarnInactive },
  { path: '/projects', label: 'Проекты', active: projectsActive, inactive: projectsInactive },
  { path: '/favorites', label: 'Избранное', active: favoritesActive, inactive: favoritesInactive },
] as const;

// Только эти пути показывают таб-бар — любой другой (карточка описания,
// карточка/форма пряжи и т.д.) его скрывает. «Проекты» сознательно не в
// TABS — у неё нет маршрута (заглушка «Скоро»), но таб-бар должен
// оставаться видимым, когда открыта одна из реальных вкладок.
const TAB_BAR_PATHS = new Set<string>(TABS.map((t) => t.path));

export function shouldShowTabBar(pathname: string): boolean {
  return TAB_BAR_PATHS.has(pathname);
}

export const TabBar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const visible = shouldShowTabBar(location.pathname);

  // Класс на <body>, не через сам компонент: страницы (Catalog/Favorites/
  // Stash) должны резервировать место под fixed-таб-бар в своём собственном
  // padding-bottom, а их CSS не может напрямую зависеть от React-состояния
  // соседнего компонента. body — общая точка, которую видят все три.
  useEffect(() => {
    document.body.classList.toggle('has-tab-bar', visible);
    return () => { document.body.classList.remove('has-tab-bar'); };
  }, [visible]);

  if (!visible) return null;

  return createPortal(
    <nav className="tab-bar" role="navigation" aria-label="Основная навигация">
      <div className="tab-bar-inner">
        {TABS.map((tab) => {
          const isActive = location.pathname === tab.path;
          return (
            <button
              key={tab.path}
              type="button"
              className="tab-bar-item"
              onClick={() => { if (!isActive) navigate(tab.path); }}
              aria-current={isActive ? 'page' : undefined}
            >
              <img
                src={isActive ? tab.active : tab.inactive}
                alt=""
                className="tab-bar-icon"
              />
              {/* Лейбл всегда серый (#9b9a9a), даже под активной иконкой —
                  так во всех состояниях в макете, меняется только цвет
                  самой иконки. */}
              <span className="tab-bar-label">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>,
    document.body,
  );
};
