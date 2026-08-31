import { useState } from 'react';
import { Button } from '../../components/Button/Button';
import { useNavigate, Link } from 'react-router-dom';
import { requestCode, verifyCode, authorLogin } from '../../api/auth';
import { useAuth } from '../../contexts/AuthContext';
import { passwordTooLong } from '../../utils/password';
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

type Tab = 'telegram' | 'password';

export function Login() {
  const [tab, setTab] = useState<Tab>('telegram');

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Rapport Admin</h1>

        <div className={styles.tabs}>
          <button
            type="button"
            className={[styles.tab, tab === 'telegram' ? styles.tabActive : ''].join(' ')}
            onClick={() => setTab('telegram')}
          >
            Telegram
          </button>
          <button
            type="button"
            className={[styles.tab, tab === 'password' ? styles.tabActive : ''].join(' ')}
            onClick={() => setTab('password')}
          >
            Логин и пароль
          </button>
        </div>

        {tab === 'telegram' ? <TelegramLoginForm /> : <PasswordLoginForm />}
      </div>
    </div>
  );
}

function TelegramLoginForm() {
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

      const hasAccess =
        user.role === 'ADMIN' ||
        (user.permissions ?? []).includes('AUTHOR_CABINET');

      if (!hasAccess) {
        toast.error('У вас нет доступа');
        return;
      }

      setToken(token);
      setUser(user);
      setIsAuthenticated(true);
      toast.success('Успешный вход');

      if (user.role === 'ADMIN') {
        navigate('/patterns', { replace: true });
      } else {
        navigate('/cabinet/', { replace: true });
      }
    } catch (err: any) {
      toast.error(err.message || 'Неверный или просроченный код');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
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
          <Button type="submit" size="lg" block disabled={isLoading || !username.trim()}>
            {isLoading ? 'Отправка...' : 'Получить код'}
          </Button>
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
          <Button type="submit" size="lg" block disabled={isLoading || code.length !== 6}>
            {isLoading ? 'Проверка...' : 'Войти'}
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
    </>
  );
}

function PasswordLoginForm() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { setToken, setUser, setIsAuthenticated } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!login.trim() || !password) return;

    if (passwordTooLong(password)) {
      toast.error('Пароль слишком длинный');
      return;
    }

    try {
      setIsLoading(true);
      const result = await authorLogin(login.trim(), password);

      if (result.mustChangePassword) {
        // No token issued on this branch — the cabinet stays locked until
        // the temp password is replaced (implementation_plan.md §3.2/§8).
        navigate('/change-password', { state: { login: result.login } });
        return;
      }

      setToken(result.token);
      setUser(result.user);
      setIsAuthenticated(true);
      toast.success('Успешный вход');
      navigate(result.user.role === 'ADMIN' ? '/patterns' : '/cabinet/', { replace: true });
    } catch (err: any) {
      toast.error(err.message || 'Неверный логин или пароль');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <p className={styles.subtitle}>Введите логин и пароль от кабинета автора</p>

      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.inputGroup}>
          <label className={styles.label}>Логин</label>
          <input
            type="text"
            className={styles.input}
            placeholder="Логин"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            disabled={isLoading}
            autoComplete="username"
            autoFocus
          />
        </div>
        <div className={styles.inputGroup}>
          <label className={styles.label}>Пароль</label>
          <div className={styles.inputWrapper}>
            <input
              type={showPassword ? 'text' : 'password'}
              className={styles.input}
              placeholder="Пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              autoComplete="current-password"
            />
            <button
              type="button"
              className={styles.togglePassword}
              onClick={() => setShowPassword((v) => !v)}
              tabIndex={-1}
              aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
            >
              <EyeIcon visible={showPassword} />
            </button>
          </div>
        </div>
        <Button type="submit" size="lg" block disabled={isLoading || !login.trim() || !password}>
          {isLoading ? 'Вход...' : 'Войти'}
        </Button>
        <Link to="/forgot-password" className={styles.link}>
          Забыли пароль?
        </Link>
      </form>
    </>
  );
}
