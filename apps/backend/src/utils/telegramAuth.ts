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
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    
    if (!hash) {
      return { isValid: false };
    }

    urlParams.delete('hash');
    const params = Array.from(urlParams.entries());
    params.sort((a, b) => a[0].localeCompare(b[0]));
    
    const dataCheckString = params.map(([key, value]) => `${key}=${value}`).join('\n');
    
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    
    if (calculatedHash !== hash) {
      return { isValid: false };
    }

    const userString = urlParams.get('user');
    let user: TelegramUserData | undefined;
    if (userString) {
      user = JSON.parse(userString);
    }

    return { isValid: true, user };
  } catch (error) {
    console.error('[validateTelegramWebAppData] Error parsing initData:', error);
    return { isValid: false };
  }
}
