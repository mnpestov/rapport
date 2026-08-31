import React, { useState } from 'react';
import {
  userLogin,
  userChangePassword,
  requestCode,
  verifyCode,
  forgotPassword,
  resetPassword,
  WebAuthError,
} from '../../api/webAuthApi';
import logo from '../../assets/paywall/rapport-logo.svg';
import './WebLogin.css';

const BOT_LINK = 'https://t.me/rapportapp_bot';

// Тот же глазик, что в формах входа админки — паттерн уже устоялся там,
// нет причин рисовать второй.
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

function PasswordField({
  label, value, onChange, disabled, autoComplete, autoFocus, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  autoComplete?: string;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="weblogin-field">
      <label className="weblogin-label">{label}</label>
      <div className="weblogin-input-wrap">
        <input
          type={visible ? 'text' : 'password'}
          className="weblogin-input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
        />
        <button
          type="button"
          className="weblogin-eye"
          onClick={() => setVisible((v) => !v)}
          tabIndex={-1}
          aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
        >
          <EyeIcon visible={visible} />
        </button>
      </div>
    </div>
  );
}

type Tab = 'password' | 'code';
// Экран смены временного пароля и экран сброса — отдельные состояния, а не
// вкладки: в них нельзя попасть напрямую, только из соответствующего флоу.
type Screen = { kind: 'tabs' } | { kind: 'change'; login: string } | { kind: 'reset'; login: string };

interface Props {
  // Вызывается после успешного входа — App.tsx переводит приложение в
  // авторизованное состояние.
  onAuthenticated: () => void;
}

export const WebLogin: React.FC<Props> = ({ onAuthenticated }) => {
  const [screen, setScreen] = useState<Screen>({ kind: 'tabs' });
  const [tab, setTab] = useState<Tab>('password');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // password tab
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');

  // code tab
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);

  // change / reset
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetCode, setResetCode] = useState('');

  const fail = (e: unknown) => {
    setError(e instanceof WebAuthError ? e.message : 'Что-то пошло не так. Попробуйте позже.');
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const handlePasswordLogin = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const result = await userLogin(login.trim(), password);
      if (result.kind === 'must_change_password') {
        // Временный пароль из бота — сессия ещё не выдана.
        setScreen({ kind: 'change', login: result.login });
        setCurrentPassword(password);
        setPassword('');
        return;
      }
      onAuthenticated();
    });
  };

  const handleRequestCode = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await requestCode(username.trim());
      setCodeSent(true);
      setNotice('Код отправлен в Telegram. Он действует 5 минут.');
    });
  };

  const handleVerifyCode = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await verifyCode(username.trim(), code.trim());
      onAuthenticated();
    });
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (screen.kind !== 'change') return;
    if (newPassword !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }
    run(async () => {
      await userChangePassword(screen.login, currentPassword, newPassword);
      onAuthenticated();
    });
  };

  const handleForgot = () => {
    const target = login.trim();
    if (!target) {
      setError('Введите логин — на него придёт код сброса');
      return;
    }
    run(async () => {
      await forgotPassword(target);
      setScreen({ kind: 'reset', login: target });
      setNotice('Если такой логин существует, код отправлен в Telegram.');
    });
  };

  const handleReset = (e: React.FormEvent) => {
    e.preventDefault();
    if (screen.kind !== 'reset') return;
    if (newPassword !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }
    run(async () => {
      await resetPassword(screen.login, resetCode.trim(), newPassword);
      // Сброс сессию не выдаёт — возвращаем на обычный вход.
      setScreen({ kind: 'tabs' });
      setTab('password');
      setPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setResetCode('');
      setNotice('Пароль изменён. Войдите с новым паролем.');
    });
  };

  const messages = (
    <>
      {error && <p className="weblogin-error">{error}</p>}
      {notice && <p className="weblogin-notice">{notice}</p>}
    </>
  );

  if (screen.kind === 'change') {
    return (
      <div className="weblogin">
        <div className="weblogin-card">
          <img src={logo} alt="Раппорт" className="weblogin-logo" />
          <h1 className="weblogin-title">Задайте свой пароль</h1>
          <p className="weblogin-sub">
            Пароль из бота временный — придумайте постоянный, от 10 символов.
          </p>
          <form onSubmit={handleChangePassword}>
            <PasswordField label="Временный пароль" value={currentPassword} onChange={setCurrentPassword} disabled={busy} autoComplete="current-password" />
            <PasswordField label="Новый пароль" value={newPassword} onChange={setNewPassword} disabled={busy} autoComplete="new-password" autoFocus />
            <PasswordField label="Повторите новый пароль" value={confirmPassword} onChange={setConfirmPassword} disabled={busy} autoComplete="new-password" />
            {messages}
            <button type="submit" className="weblogin-btn" disabled={busy || !newPassword || !confirmPassword}>
              {busy ? 'Сохраняем…' : 'Сохранить и войти'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (screen.kind === 'reset') {
    return (
      <div className="weblogin">
        <div className="weblogin-card">
          <img src={logo} alt="Раппорт" className="weblogin-logo" />
          <h1 className="weblogin-title">Сброс пароля</h1>
          <p className="weblogin-sub">Введите код из Telegram и новый пароль.</p>
          <form onSubmit={handleReset}>
            <div className="weblogin-field">
              <label className="weblogin-label">Код из Telegram</label>
              <input
                className="weblogin-input"
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                disabled={busy}
                autoFocus
              />
            </div>
            <PasswordField label="Новый пароль" value={newPassword} onChange={setNewPassword} disabled={busy} autoComplete="new-password" />
            <PasswordField label="Повторите пароль" value={confirmPassword} onChange={setConfirmPassword} disabled={busy} autoComplete="new-password" />
            {messages}
            <button type="submit" className="weblogin-btn" disabled={busy || !resetCode || !newPassword}>
              {busy ? 'Сохраняем…' : 'Сменить пароль'}
            </button>
            <button type="button" className="weblogin-link" onClick={() => setScreen({ kind: 'tabs' })}>
              Вернуться ко входу
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="weblogin">
      <div className="weblogin-card">
        <img src={logo} alt="Раппорт" className="weblogin-logo" />
        <h1 className="weblogin-title">Вход</h1>

        <div className="weblogin-tabs">
          <button
            type="button"
            className={`weblogin-tab${tab === 'password' ? ' weblogin-tab--active' : ''}`}
            onClick={() => { setTab('password'); setError(null); setNotice(null); }}
          >
            Логин и пароль
          </button>
          <button
            type="button"
            className={`weblogin-tab${tab === 'code' ? ' weblogin-tab--active' : ''}`}
            onClick={() => { setTab('code'); setError(null); setNotice(null); }}
          >
            Код в Telegram
          </button>
        </div>

        {tab === 'password' ? (
          <form onSubmit={handlePasswordLogin}>
            <div className="weblogin-field">
              <label className="weblogin-label">Логин</label>
              <input
                className="weblogin-input"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                autoComplete="username"
                disabled={busy}
                autoFocus
              />
            </div>
            <PasswordField label="Пароль" value={password} onChange={setPassword} disabled={busy} autoComplete="current-password" />
            {messages}
            <button type="submit" className="weblogin-btn" disabled={busy || !login.trim() || !password}>
              {busy ? 'Входим…' : 'Войти'}
            </button>
            <button type="button" className="weblogin-link" onClick={handleForgot} disabled={busy}>
              Забыли пароль?
            </button>
          </form>
        ) : (
          <form onSubmit={codeSent ? handleVerifyCode : handleRequestCode}>
            <div className="weblogin-field">
              <label className="weblogin-label">Ваш @username в Telegram</label>
              <input
                className="weblogin-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="@username"
                autoComplete="username"
                disabled={busy || codeSent}
                autoFocus
              />
            </div>
            {codeSent && (
              <div className="weblogin-field">
                <label className="weblogin-label">Код из Telegram</label>
                <input
                  className="weblogin-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  disabled={busy}
                  autoFocus
                />
              </div>
            )}
            {messages}
            <button type="submit" className="weblogin-btn" disabled={busy || (codeSent ? !code.trim() : !username.trim())}>
              {busy ? 'Отправляем…' : codeSent ? 'Войти' : 'Получить код'}
            </button>
            {codeSent && (
              <button type="button" className="weblogin-link" onClick={() => { setCodeSent(false); setCode(''); }}>
                Изменить username
              </button>
            )}
            <p className="weblogin-hint">
              Работает, если у вас задан @username в Telegram и вы хотя бы раз открывали приложение.
              Иначе войдите по логину и паролю.
            </p>
          </form>
        )}

        <div className="weblogin-footer">
          Нет логина?{' '}
          <a href={BOT_LINK} target="_blank" rel="noreferrer">
            Получите его в боте
          </a>
        </div>
      </div>
    </div>
  );
};
