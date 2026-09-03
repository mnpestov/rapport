import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { FavoritesProvider } from './context/FavoritesContext'
import { PriceAlertsProvider } from './context/PriceAlertsContext'
import './index.css'
import App from './App.tsx'

// Скроллом приложение управляет само: карточка описания уводит страницу
// наверх при смене паттерна (PatternDetails.tsx), каталог восстанавливает
// сохранённую позицию из sessionStorage. Браузерное автовосстановление
// делает это же третьим способом и мешает обоим.
//
// На карточке это ломало шапку: WebKit применял запомненную позицию уже
// после того, как контент вырос, и не пересчитывал position: sticky для
// скролла, который сделал сам, — шапка с кнопкой «Назад» оставалась в
// статичной позиции выше экрана и появлялась только когда страницу трогали
// руками.
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual'
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PriceAlertsProvider>
      <FavoritesProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </FavoritesProvider>
    </PriceAlertsProvider>
  </React.StrictMode>,
)
