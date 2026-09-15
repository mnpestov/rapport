-- Разовый баннер "новая функция" (подписка на цены) действующим платным
-- подписчикам — variant='price_alert_intro'. Отдельное поле от
-- lastPaywallShownAt, см. комментарий в schema.prisma.
ALTER TABLE "User" ADD COLUMN "priceAlertIntroShownAt" TIMESTAMP(3);
