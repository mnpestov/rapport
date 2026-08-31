import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!JWT_ACCESS_SECRET) {
  throw new Error("JWT_ACCESS_SECRET is not defined in environment variables");
}
if (!JWT_REFRESH_SECRET) {
  throw new Error("JWT_REFRESH_SECRET is not defined in environment variables");
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const REFRESH_EXPIRES_IN = '30d';

export interface JwtPayload {
  userId: string;
  telegramId: string;
  // Веб-сессия, которой принадлежит токен (BROWSER_ACCESS_PLAN.md §3.3 п.2).
  // Присутствует ТОЛЬКО у токенов браузерного входа. По нему
  // enforceWebSubscription отличает веб-запрос от Mini App (там claim'а нет
  // — middleware такие пропускает) и находит WebSession, чтобы проверить
  // отзыв и свежесть проверки подписки.
  //
  // Роли здесь СОЗНАТЕЛЬНО нет. Раньше веб-пути клали в токен `role`, а
  // Mini App — нет; читал его при этом никто (requireAdmin и
  // requirePermission перечитывают роль из БД — см. комментарий в
  // authController про "NOT a JWT claim"). Claim, живущий 24 часа, устаревал
  // бы при выдаче/отзыве прав, поэтому единый ответ — не класть его вовсе.
  sessionId?: string;
}

export const generateToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, JWT_ACCESS_SECRET, { expiresIn: JWT_EXPIRES_IN as any });
};

export const verifyToken = (token: string): JwtPayload => {
  return jwt.verify(token, JWT_ACCESS_SECRET) as JwtPayload;
};

export const generateRefreshToken = (payload: { userId: string }): string => {
  // jti — случайный идентификатор токена. Без него payload состоит из
  // userId и iat, а iat имеет секундную точность: два refresh-токена,
  // выданных одному пользователю в пределах одной секунды, получались
  // ПОБАЙТОВО одинаковыми, давали одинаковый SHA-256 и падали на unique
  // constraint RefreshToken.token.
  //
  // Раньше это почти не встречалось (вход — редкое разовое действие), но
  // сценарий «сменил временный пароль → тут же вошёл» делает две выдачи
  // подряд штатными: обе укладываются в одну секунду.
  //
  // На верификацию не влияет — jti не читается, важна только подпись.
  return jwt.sign(
    { ...payload, jti: crypto.randomUUID() },
    JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRES_IN as any },
  );
};

export const verifyRefreshToken = (token: string): { userId: string } => {
  return jwt.verify(token, JWT_REFRESH_SECRET) as { userId: string };
};
