import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { useAuthBootstrap } from './hooks/useAuthBootstrap';
import { RequireAuth } from './routes/RequireAuth';
import { RequireAuthor } from './routes/RequireAuthor';
import { AdminLayout } from './layouts/AdminLayout';
import { Login } from './pages/Login/Login';
import { Dashboard } from './pages/Dashboard/Dashboard';
import { Patterns } from './pages/Patterns/Patterns';
import { Authors } from './pages/Authors/Authors';
import { Whitelist } from './pages/Whitelist/Whitelist';
import { Requests } from './pages/Requests/Requests';
import { Users } from './pages/Users/Users';
import { PriceCheck } from './pages/PriceCheck/PriceCheck';
import { Payments } from './pages/Payments/Payments';
import { Dictionaries } from './pages/Dictionaries/Dictionaries';
import { Yarns } from './pages/Yarns/Yarns';

function BootstrapSpinner() {
  return (
    <div
      aria-live="polite"
      aria-label="Восстановление сессии..."
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        backgroundColor: '#F8F9FA',
      }}
    >
      <div
        role="status"
        style={{
          width: 32,
          height: 32,
          border: '3px solid #83942C',
          borderTopColor: 'transparent',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
    </div>
  );
}

function AppRoutes() {
  const { isAuthenticated } = useAuth();
  const { showSpinner } = useAuthBootstrap();

  if (isAuthenticated === null) {
    return showSpinner ? <BootstrapSpinner /> : null;
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/patterns" replace /> : <Login />}
      />

      <Route element={<RequireAuth />}>
        <Route element={<AdminLayout />}>
          <Route index element={<Navigate to="/patterns" replace />} />
          <Route path="patterns" element={<Patterns variant="admin" />} />
          <Route path="authors" element={<Authors />} />
          <Route path="stats" element={<Dashboard />} />
          <Route path="requests" element={<Requests />} />
          <Route path="whitelist" element={<Whitelist />} />
          <Route path="users" element={<Users />} />
          <Route path="payments" element={<Payments />} />
          <Route path="price-check" element={<PriceCheck />} />
          <Route path="dictionaries" element={<Dictionaries />} />
          <Route path="yarns" element={<Yarns />} />
        </Route>
      </Route>

      <Route element={<RequireAuthor />}>
        <Route element={<AdminLayout variant="author" />}>
          <Route path="cabinet" element={<Patterns variant="author" />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" />
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
