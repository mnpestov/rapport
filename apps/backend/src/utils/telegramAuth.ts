import crypto from 'crypto';

export interface TelegramUserData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export function validateTelegramWebAppData(initData: string, botToken: string): { isValid: boolean; user?: TelegramUserData } {
  try {
    if (!botToken) {
      return { isValid: false };
    }

    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    
    if (!hash) {
      return { isValid: false };
    }

    // Explicitly delete ONLY hash from params before sorting
    urlParams.delete('hash');

    const params = Array.from(urlParams.entries());
    params.sort((a, b) => a[0].localeCompare(b[0]));
    
    const dataCheckString = params.map(([key, value]) => `${key}=${value}`).join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    
    if (calculatedHash !== hash) {
      return { isValid: false };
    }

    // Reject replayed initData older than 24 hours (Telegram recommendation).
    // auth_date is a Unix timestamp (seconds) set by Telegram at the moment of
    // Mini App launch. Without this check, any intercepted initData with a valid
    // signature would be accepted indefinitely.
    const authDateRaw = urlParams.get('auth_date');
    if (!authDateRaw) {
      return { isValid: false };
    }
    const authDate = parseInt(authDateRaw, 10);
    const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;
    if (isNaN(authDate) || Math.floor(Date.now() / 1000) - authDate > MAX_INIT_DATA_AGE_SECONDS) {
      return { isValid: false };
    }

    const userString = urlParams.get('user');
    let user: TelegramUserData | undefined;
    if (userString) {
      try {
        user = JSON.parse(userString);
      } catch (e) {
        return { isValid: false };
      }
    }

    return { isValid: true, user };
  } catch (error) {
    console.error('[validateTelegramWebAppData] Error parsing initData:', error);
    return { isValid: false };
  }
}
