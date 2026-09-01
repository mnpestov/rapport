import React, { useEffect, useState } from 'react';
import {
  canPromptInstall,
  promptInstall,
  shouldShowIosHint,
  isStandalone,
  PWA_INSTALLABLE_EVENT,
} from '../../api/pwa';
import { isWebMode } from '../../api/authSession';
import { Share } from 'lucide-react';
import iconUrl from '../../assets/paywall/logo-small-red.svg';
import './InstallPrompt.css';

// Один раз закрыл — больше не показываем на этом устройстве.
const DISMISSED_KEY = 'pwa_install_dismissed';

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function markDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // приватный режим — просто не запомнится, покажем в следующий раз
  }
}

/**
 * Плашка «Установить приложение».
 *
 * Показывается только в браузере (не в Telegram), не в уже установленном
 * приложении и если пользователь её раньше не закрыл.
 *
 * Android: настоящая кнопка — вызывает системный промт установки.
 * iOS: кнопки нет (Safari не даёт), вместо неё короткая инструкция
 * «Поделиться → На экран «Домой»».
 */
export const InstallPrompt: React.FC = () => {
  const [androidReady, setAndroidReady] = useState(canPromptInstall());
  const [closed, setClosed] = useState(wasDismissed());

  useEffect(() => {
    const onChange = () => setAndroidReady(canPromptInstall());
    window.addEventListener(PWA_INSTALLABLE_EVENT, onChange);
    return () => window.removeEventListener(PWA_INSTALLABLE_EVENT, onChange);
  }, []);

  if (!isWebMode() || isStandalone() || closed) return null;

  const iosHint = shouldShowIosHint();
  // Ни промта Android, ни iOS-подсказки — показывать нечего.
  if (!androidReady && !iosHint) return null;

  const close = () => {
    markDismissed();
    setClosed(true);
  };

  const install = async () => {
    const accepted = await promptInstall();
    if (accepted) setClosed(true);
    // Если отказался — плашку не прячем, промт всё равно уже «потрачен»,
    // но пусть остаётся видимой на случай, если передумает после
    // перезагрузки.
  };

  return (
    <div className="install-prompt">
      <img src={iconUrl} alt="" className="install-prompt-icon" />
      <div className="install-prompt-text">
        {iosHint ? (
          <>
            <b>Добавьте Раппорт на экран «Домой»</b>
            <span>
              Нажмите{' '}
              <Share className="install-prompt-share" aria-label="Поделиться" />{' '}
              внизу экрана, затем
              <br />
              «Добавить на экран «Домой»
            </span>
          </>
        ) : (
          <>
            <b>Установите приложение</b>
            <span>Быстрый доступ с рабочего стола, без адресной строки</span>
          </>
        )}
      </div>
      {androidReady && (
        <button type="button" className="install-prompt-btn" onClick={install}>
          Установить
        </button>
      )}
      <button
        type="button"
        className="install-prompt-close"
        onClick={close}
        aria-label="Закрыть"
      >
        ×
      </button>
    </div>
  );
};
