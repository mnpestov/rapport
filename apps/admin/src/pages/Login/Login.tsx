import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { requestCode, verifyCode } from '../../api/auth';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import styles from './Login.module.css';

export function Login() {
  const [step, setStep] = useState<1 | 2>(1);
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { setToken, setUser, setIsAuthenticated } = useAuth();

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    try {
      setIsLoading(true);
      const res = await requestCode(username);
      setStep(2);

      if (res.devError) {
        toast.error('Ошибка разработчика: посмотрите консоль', { duration: 5000 });
      } else if (res.devCode) {
        toast.success('Код выведен в консоль браузера (Dev Mode)');
      } else {
        toast.success('Код отправлен в Telegram');
      }
    } catch (err: any) {
      toast.error(err.message || 'Ошибка при запросе кода');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || code.length !== 6) {
      toast.error('Введите 6-значный код');
      return;
    }

    try {
      setIsLoading(true);
      const { token, user } = await verifyCode(username, code);

      if (user.role !== 'ADMIN') {
        toast.error('У вас нет прав администратора');
        return;
      }

      setToken(token);
      setUser(user);
      setIsAuthenticated(true);
      toast.success('Успешный вход');
      navigate('/patterns', { replace: true });
    } catch (err: any) {
      toast.error(err.message || 'Неверный или просроченный код');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Rapport Admin</h1>
        <p className={styles.subtitle}>
          {step === 1
            ? 'Введите ваш Telegram username для входа'
            : 'Введите 6-значный код, отправленный ботом'}
        </p>

        {step === 1 ? (
          <form className={styles.form} onSubmit={handleRequestCode}>
            <div className={styles.inputGroup}>
              <label className={styles.label}>Username</label>
              <input
                type="text"
                className={styles.input}
                placeholder="Например, @durov"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
                autoFocus
              />
            </div>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={isLoading || !username.trim()}
            >
              {isLoading ? 'Отправка...' : 'Получить код'}
            </button>
          </form>
        ) : (
          <form className={styles.form} onSubmit={handleVerifyCode}>
            <div className={styles.inputGroup}>
              <label className={styles.label}>Код подтверждения</label>
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
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={isLoading || code.length !== 6}
            >
              {isLoading ? 'Проверка...' : 'Войти'}
            </button>
            <button
              type="button"
              className={styles.backBtn}
              onClick={() => {
                setStep(1);
                setCode('');
              }}
              disabled={isLoading}
            >
              Вернуться назад
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
