import { useState } from 'react';
import { Button } from '../../components/Button/Button';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { authorChangePassword } from '../../api/auth';
import { useAuth } from '../../contexts/AuthContext';
import { passwordTooLong, MIN_PASSWORD_LENGTH } from '../../utils/password';
import toast from 'react-hot-toast';
import styles from './Login.module.css';

// Reached only from the author-login mustChangePassword branch (no token
// issued there — implementation_plan.md §3.2/§8), so login comes through
// router state, not auth context.
export function ChangePassword() {
  const location = useLocation();
  const login = (location.state as { login?: string } | null)?.login;

  if (!login) {
    return <Navigate to="/login" replace />;
  }

  return <ChangePasswordForm login={login} />;
}

function ChangePasswordForm({ login }: { login: string }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { setToken, setUser, setIsAuthenticated } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (passwordTooLong(currentPassword)) {
      toast.error('Текущий пароль слишком длинный');
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      toast.error(`Новый пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`);
      return;
    }
    if (passwordTooLong(newPassword)) {
      toast.error('Новый пароль слишком длинный');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Пароли не совпадают');
      return;
    }
    if (newPassword === currentPassword) {
      toast.error('Новый пароль должен отличаться от текущего');
      return;
    }

    try {
      setIsLoading(true);
      const { token, user } = await authorChangePassword(login, currentPassword, newPassword);
      setToken(token);
      setUser(user);
      setIsAuthenticated(true);
      toast.success('Пароль изменён');
      navigate('/cabinet/', { replace: true });
    } catch (err: any) {
      toast.error(err.message || 'Не удалось сменить пароль');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Смена пароля</h1>
        <p className={styles.subtitle}>
          Это временный пароль. Установите свой, чтобы продолжить.
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Временный пароль</label>
            <input
              type="password"
              className={styles.input}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={isLoading}
              autoComplete="current-password"
              autoFocus
            />
          </div>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Новый пароль</label>
            <input
              type="password"
              className={styles.input}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={isLoading}
              autoComplete="new-password"
            />
          </div>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Подтвердите новый пароль</label>
            <input
              type="password"
              className={styles.input}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isLoading}
              autoComplete="new-password"
            />
          </div>
          <Button
            type="submit"
            size="lg"
            block
            disabled={isLoading || !currentPassword || !newPassword || !confirmPassword}
          >
            {isLoading ? 'Сохранение...' : 'Сохранить и войти'}
          </Button>
        </form>
      </div>
    </div>
  );
}
