import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { RequireAuth } from './routes/RequireAuth'
import { AdminLayout } from './layouts/AdminLayout'
import { Login } from './pages/Login/Login'
import { Dashboard } from './pages/Dashboard/Dashboard'
import { Patterns } from './pages/Patterns/Patterns'
import { Authors } from './pages/Authors/Authors'
import { Whitelist } from './pages/Whitelist/Whitelist'
import { Requests } from './pages/Requests/Requests'

import { Toaster } from 'react-hot-toast';

export default function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" />
      <Routes>
        {/* Public */}
        <Route path="/login" element={<Login />} />

        {/* Protected: auth guard wraps the admin shell */}
        <Route element={<RequireAuth />}>
          <Route element={<AdminLayout />}>
            <Route index element={<Navigate to="/patterns" replace />} />
            <Route path="patterns" element={<Patterns />} />
            <Route path="authors" element={<Authors />} />
            <Route path="stats" element={<Dashboard />} />
            <Route path="requests" element={<Requests />} />
            <Route path="whitelist" element={<Whitelist />} />
          </Route>
        </Route>

        {/* Fallback → home (which itself redirects to /login when unauthenticated) */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
