import React from 'react';
import heroLogo from '../../assets/paywall/rapport-logo.svg';
import heroScreenshot from '../../assets/landing/hero-screenshot.png';
import phoneFrame from '../../assets/landing/phone-frame.png';
import './TelegramOnly.css';

const BOT_APP_LINK = 'https://t.me/rapportapp_bot/rapport';
const BOT_CHAT_LINK = 'https://t.me/rapportapp_bot';

interface Advantage {
  title: string;
  text: string;
}

// Базовый (бесплатный) функционал — то, что доступно без PREMIUM_CORE/EXTRA.
// Взято из макета Figma (node 999:7406), с двумя правками:
// - "Похожие модели" и "Фильтр по толщине пряжи" убраны — в макете они były
//   продублированы один в один с платным списком ниже, хотя по факту это
//   часть PREMIUM_EXTRA/CORE (см. PAID_TIER_PERMISSIONS_PLAN.md §0, тот же
//   список уже сверен в PaywallModal.tsx) — оставлять их в бесплатном
//   списке значило бы разойтись с уже проверенным источником истины.
// - У "Фильтр по автору" в макете стояло описание от "Видимость цены"
//   (явная опечатка/копипаста) — переписано на соответствующее теме.
const FREE_ADVANTAGES: Advantage[] = [
  { title: 'Фильтр по типу изделия', text: '41 категория на любой вкус: от джемперов до сумок. Быстро находите модели нужного силуэта.' },
  { title: 'Фильтр по автору', text: 'Ищите описания у конкретного автора, если уже нашли своего любимого мастера.' },
  { title: 'Фильтр по характеристикам', text: 'Выбирайте конкретный приём (например, ажуры) и получайте точную подборку — никакой воды.' },
  { title: 'Фильтр по инструменту', text: 'Вяжете только крючком или спицами? Отсеивайте лишнее и сразу переходите к подходящим схемам.' },
  { title: 'Тег «Новинка»', text: 'Свежие описания, появившиеся в каталоге за последнюю неделю. Будьте в тренде.' },
  { title: 'Тег «Бесплатные»', text: 'Экономьте бюджет: более 95 описаний доступны бесплатно. Качественные модели без стоимости.' },
  { title: 'Избранное', text: 'Добавляйте понравившиеся описания в один клик. Собирайте собственную коллекцию для будущих проектов.' },
  { title: 'Постоянное обновление', text: 'Уже 3100+ описаний, и каждую неделю база пополняется. Всегда есть что выбрать.' },
];

// PREMIUM_EXTRA — тот же список и порядок, что ADVANTAGES в PaywallModal.tsx
// (Figma 970:12151, уже сверен с PAID_TIER_PERMISSIONS_PLAN.md §0), но без
// картинок — в текущей версии макета (999:7406) у платного списка их убрали.
const PAID_ADVANTAGES: Advantage[] = [
  { title: 'Тег «Скидка»', text: 'Фильтруйте описания с акциями. Экономьте на том, что и так планировали купить.' },
  { title: 'Цена', text: 'Стоимость описания теперь сразу на карточке. Без лишних действий.' },
  { title: 'Гиперссылка на автора', text: 'Переходите к другим работам мастера в один клик прямо со страницы описания.' },
  { title: 'Сортировка по цене', text: 'Упорядочивайте модели — от дешёвых к дорогим или наоборот.' },
  { title: 'Похожие модели', text: 'Рекомендации описаний со схожими характеристиками. Легко выбрать альтернативу.' },
  { title: 'Множественность фото', text: '5 фотографий вместо одной. Рассмотрите модель со всех сторон.' },
  { title: 'Фильтр по цене', text: 'Отбирайте описания в нужном ценовом диапазоне.' },
  { title: 'Фильтры в Избранном', text: 'Находите нужное среди сохранёнок: по плотности, пряже, типу изделия.' },
  { title: 'Фильтр по толщине пряжи', text: 'Подборка моделей под метраж вашей пряжи. Используйте то, что уже есть.' },
  { title: 'Фильтр по плотности', text: 'Находите описания, идеально подходящие под вашу плотность вязания. Никаких пересчётов.' },
];

export const TelegramOnly: React.FC = () => {
  return (
    <div className="landing">
      <header className="landing-header">
        <img src={heroLogo} alt="Rapport" className="landing-header-logo" />
        <a className="landing-header-bot" href={BOT_CHAT_LINK}>@rapportapp_bot</a>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-text">
          <img src={heroLogo} alt="Rapport" className="landing-hero-logo" />
          <h1 className="landing-hero-title">Агрегатор вязальных описаний</h1>
          <div className="landing-hero-desc">
            <p>Все описания в одном месте!</p>
            <p>Раппорт — это Mini App. Он работает только внутри мессенджера — откройте приложение через Telegram, чтобы продолжить.</p>
          </div>
          <a className="landing-btn landing-btn-primary" href={BOT_APP_LINK}>Найти описание</a>
        </div>
        <div className="landing-hero-visual">
          <div className="landing-phone-mockup">
            <img src={heroScreenshot} alt="Скриншот каталога описаний в приложении Rapport" className="landing-phone-screenshot" />
            <img src={phoneFrame} alt="" className="landing-phone-frame" />
          </div>
        </div>
      </section>

      <section className="landing-tiers">
        <h2 className="landing-section-title">Навигация по возможностям</h2>
        <div className="landing-tiers-grid">
          <div className="landing-tier landing-tier-free">
            <div className="landing-tier-header">
              <p className="landing-tier-name">Базовый доступ</p>
              <p className="landing-tier-price">
                <strong>Бесплатно</strong>
                <br />
                для подписчиков ТГ-канала Фешн Хурма
              </p>
            </div>
            <ul className="landing-advantages">
              {FREE_ADVANTAGES.map((advantage) => (
                <li className="landing-advantage" key={advantage.title}>
                  <div className="landing-advantage-text">
                    <p className="landing-advantage-title">{advantage.title}</p>
                    <p className="landing-advantage-description">{advantage.text}</p>
                  </div>
                </li>
              ))}
            </ul>
            <a className="landing-btn landing-btn-secondary" href={BOT_APP_LINK}>Найти описание</a>
          </div>

          <div className="landing-tier landing-tier-paid">
            <div className="landing-tier-header">
              <p className="landing-tier-name">Расширенный доступ</p>
              <p className="landing-tier-price">69 ₽ / мес.</p>
            </div>
            <p className="landing-tier-callout">Все возможности Базового доступа + Расширенный функционал</p>
            <ul className="landing-advantages">
              {PAID_ADVANTAGES.map((advantage) => (
                <li className="landing-advantage" key={advantage.title}>
                  <div className="landing-advantage-text">
                    <p className="landing-advantage-title">{advantage.title}</p>
                    <p className="landing-advantage-description">{advantage.text}</p>
                  </div>
                </li>
              ))}
            </ul>
            <a className="landing-btn landing-btn-primary" href={BOT_APP_LINK}>Оплатить</a>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-reqs">
          <p>Самозанятый Пестова Юлия Юрьевна</p>
          <p>ИНН 410116038191</p>
          <p>г. Москва</p>
          <p className="landing-footer-copy">© 2026 Раппорт</p>
        </div>
        <div className="landing-footer-links">
          <a href="/oferta">Публичная оферта</a>
          <a href="/privacy">Политика обработки персональных данных</a>
        </div>
      </footer>
    </div>
  );
};
