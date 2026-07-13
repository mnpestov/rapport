import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function RequireAuthor() {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!(user?.permissions ?? []).includes('AUTHOR_CABINET')) {
    return user?.role === 'ADMIN'
      ? <Navigate to="/patterns" replace />
      : <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
