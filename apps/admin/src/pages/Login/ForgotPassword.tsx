import { useState } from 'react';
import { Button } from '../../components/Button/Button';
import { useNavigate, Link } from 'react-router-dom';
import { forgotPassword, resetPassword } from '../../api/auth';
import { passwordTooLong, MIN_PASSWORD_LENGTH } from '../../utils/password';
import toast from 'react-hot-toast';
import styles from './Login.module.css';

export function ForgotPassword() {
  const [step, setStep] = useState<1 | 2>(1);
  const [login, setLogin] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!login.trim()) return;

    try {
      setIsLoading(true);
      await forgotPassword(login.trim());
      // Generic message regardless of whether the login exists — the
      // backend responds { ok: true } either way (implementation_plan.md §3.4).
      toast.success('Если логин верен, вы получите код в Telegram');
      setStep(2);
    } catch (err: any) {
      toast.error(err.message || 'Не удалось отправить код');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || code.length !== 6) {
      toast.error('Введите 6-значный код');
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

    try {
      setIsLoading(true);
      await resetPassword(login.trim(), code, newPassword);
      toast.success('Пароль сброшен');
      navigate('/login', { replace: true });
    } catch (err: any) {
      toast.error(err.message || 'Не удалось сбросить пароль');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Восстановление пароля</h1>
        <p className={styles.subtitle}>
          {step === 1
            ? 'Введите логин от кабинета автора'
            : 'Введите код из Telegram и новый пароль'}
        </p>

        {step === 1 ? (
          <form className={styles.form} onSubmit={handleRequestReset}>
            <div className={styles.inputGroup}>
              <label className={styles.label}>Логин</label>
              <input
                type="text"
                className={styles.input}
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                disabled={isLoading}
                autoComplete="username"
                autoFocus
              />
            </div>
            <Button type="submit" size="lg" block disabled={isLoading || !login.trim()}>
              {isLoading ? 'Отправка...' : 'Отправить код'}
            </Button>
            <Link to="/login" className={styles.link}>
              Вернуться к входу
            </Link>
          </form>
        ) : (
          <form className={styles.form} onSubmit={handleReset}>
            <div className={styles.inputGroup}>
              <label className={styles.label}>Код из Telegram</label>
              <input
                type="text"
                className={styles.input}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                disabled={isLoading}
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
              disabled={isLoading || code.length !== 6 || !newPassword || !confirmPassword}
            >
              {isLoading ? 'Сохранение...' : 'Сбросить пароль'}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              block
              onClick={() => {
                setStep(1);
                setCode('');
              }}
              disabled={isLoading}
            >
              Вернуться назад
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
