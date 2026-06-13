import React, { useEffect, useState } from 'react';
import { fetchChannelInfo, ChannelInfo } from '../../api/channelApi';
import './SubscriptionRequired.css';

export const SubscriptionRequired: React.FC = () => {
  const [channel, setChannel] = useState<ChannelInfo | null>(null);

  useEffect(() => {
    fetchChannelInfo().then(info => {
      if (info) setChannel(info);
    });
  }, []);

  const handleSubscribe = () => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink("https://t.me/fashionhurma");
    } else {
      window.open("https://t.me/fashionhurma", "_blank");
    }
  };

  const handleCheck = () => {
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
            {channel.photoUrl ? (
              <img src={channel.photoUrl} alt="Аватар канала" className="subscription-avatar" />
            ) : (
              <div className="subscription-avatar-placeholder"></div>
            )}
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
    </div>
  );
};
