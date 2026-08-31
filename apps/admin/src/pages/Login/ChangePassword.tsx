import { useState } from 'react';
import { Button } from '../../components/Button/Button';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { authorChangePassword } from '../../api/auth';
import { useAuth } from '../../contexts/AuthContext';
import { passwordTooLong, MIN_PASSWORD_LENGTH } from '../../utils/password';
import toast from 'react-hot-toast';
import styles from './Login.module.css';

function EyeIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

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
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
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
            <div className={styles.inputWrapper}>
              <input
                type={showCurrent ? 'text' : 'password'}
                className={styles.input}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="current-password"
                autoFocus
              />
              <button
                type="button"
                className={styles.togglePassword}
                onClick={() => setShowCurrent((v) => !v)}
                tabIndex={-1}
                aria-label={showCurrent ? 'Скрыть пароль' : 'Показать пароль'}
              >
                <EyeIcon visible={showCurrent} />
              </button>
            </div>
          </div>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Новый пароль</label>
            <div className={styles.inputWrapper}>
              <input
                type={showNew ? 'text' : 'password'}
                className={styles.input}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="new-password"
              />
              <button
                type="button"
                className={styles.togglePassword}
                onClick={() => setShowNew((v) => !v)}
                tabIndex={-1}
                aria-label={showNew ? 'Скрыть пароль' : 'Показать пароль'}
              >
                <EyeIcon visible={showNew} />
              </button>
            </div>
          </div>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Подтвердите новый пароль</label>
            <div className={styles.inputWrapper}>
              <input
                type={showConfirm ? 'text' : 'password'}
                className={styles.input}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="new-password"
              />
              <button
                type="button"
                className={styles.togglePassword}
                onClick={() => setShowConfirm((v) => !v)}
                tabIndex={-1}
                aria-label={showConfirm ? 'Скрыть пароль' : 'Показать пароль'}
              >
                <EyeIcon visible={showConfirm} />
              </button>
            </div>
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
