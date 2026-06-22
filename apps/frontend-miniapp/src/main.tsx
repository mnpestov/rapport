import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { FavoritesProvider } from './context/FavoritesContext'
import './index.css'
import App from './App.tsx'
// DIAG: remove after investigation ↓
import { initDiagLogger, diagLog } from './lib/diagnosticLogger'
import { registerGlobalErrorHandlers } from './lib/globalErrorHandlers'
import { DiagErrorBoundary } from './components/DiagErrorBoundary'

initDiagLogger()
registerGlobalErrorHandlers()
diagLog('APP_START', 'Application started')
// DIAG: remove after investigation ↑

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* DIAG: remove DiagErrorBoundary after investigation */}
    <DiagErrorBoundary>
      <FavoritesProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </FavoritesProvider>
    </DiagErrorBoundary>
  </React.StrictMode>,
)
