import React, { useEffect, useState } from 'react';
import { fetchChannelInfo, ChannelInfo } from '../../api/channelApi';
import { isWebMode, logoutWeb } from '../../api/authSession';
import { subscriptionRecheck } from '../../api/webAuthApi';
import { trackSubscribeClick } from '../../api/analyticsApi';
import avatarPlaceholder from '../../assets/avatar.png';
import './SubscriptionRequired.css';

interface Props {
  channelInfo: ChannelInfo | null;
}

export const SubscriptionRequired: React.FC<Props> = ({ channelInfo: channel }) => {
  const [showToast, setShowToast] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const handleSubscribe = () => {
    trackSubscribeClick();
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink("https://t.me/fashionhurma");
      setTimeout(() => tg.close(), 300);
    } else {
      window.open("https://t.me/fashionhurma", "_blank");
    }
  };

  const handleSupportBot = () => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink("https://t.me/rapportapp_bot?start=support");
      setTimeout(() => tg.close(), 300);
    } else {
      window.open("https://t.me/rapportapp_bot?start=support", "_blank");
    }
  };

  const handleCheck = async () => {
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);

    // В браузере это единственное место, где перепроверка подписки нужна
    // ПРИНУДИТЕЛЬНО: человек только что подписался и не должен ждать
    // истечения серверного кэша. В Mini App — прежний путь через
    // auth:recheck (там перезапрашивается вся авторизация).
    if (isWebMode()) {
      const ok = await subscriptionRecheck();
      if (ok) {
        window.location.reload();
      } else if (ok === null) {
        // Лимит 1/мин — не выдаём это за «вы не подписаны».
        setCheckError('Проверяем не чаще раза в минуту. Попробуйте ещё раз чуть позже.');
        setTimeout(() => setCheckError(null), 5000);
      }
      return;
    }

    window.dispatchEvent(new CustomEvent("auth:recheck"));
  };

  return (
    <div className="subscription-container">
      <div className="subscription-header-text">
        Приложение доступно только для подписчиков ТГ канала «Фешн хурма»
      </div>

      {channel ? (
        <div className="subscription-channel-info">
          <div className="subscription-avatar-wrapper">
            <img
              src={channel.photoUrl || avatarPlaceholder}
              alt="Аватар канала"
              className="subscription-avatar"
            />
          </div>
          <div className="subscription-channel-title">
            {channel.title || "Фешн хурма"}
          </div>
          <div className="subscription-channel-subscribers">
            {channel.subscriberCount ? `${channel.subscriberCount.toLocaleString()} подписчиков` : ""}
          </div>
          {channel.description && (
            <div className="subscription-channel-desc">
              {channel.description}
            </div>
          )}
        </div>
      ) : (
        <div className="subscription-channel-skeleton">Загрузка информации о канале...</div>
      )}

      <div className="subscription-actions">
        <button className="subscription-btn-subscribe" onClick={handleSubscribe}>
          Подписаться
        </button>
        <button className="subscription-btn-check" onClick={handleCheck}>
          Проверить подписку
        </button>
      </div>

      {showToast && !checkError && (
        <div className="subscription-toast">
          Проверка подписки...
        </div>
      )}
      {checkError && (
        <div className="subscription-toast">
          {checkError}
        </div>
      )}
      <button className="subscription-link-support" onClick={handleSupportBot}>
        Я подписана, но не могу войти в приложение
      </button>
      {/* Браузерная версия: без выхода отписавшийся оказался бы заперт на
          этом экране — сменить аккаунт было бы нечем (в Telegram такой
          проблемы нет, там аккаунт задаёт сам мессенджер). */}
      {isWebMode() && (
        <button
          className="subscription-logout"
          onClick={async () => {
            await logoutWeb();
            window.location.reload();
          }}
        >
          Выйти
        </button>
      )}
    </div>
  );
};
