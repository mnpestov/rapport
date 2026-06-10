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
    console.log(`\n--- [TelegramAuth DEBUG] ---`);
    console.log(`[TelegramAuth] BOT_TOKEN loaded: ${botToken ? 'yes' : 'no'}`);
    if (botToken) {
      console.log(`[TelegramAuth] BOT_TOKEN preview: ${botToken.substring(0, 8)}...`);
    }

    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    
    console.log(`[TelegramAuth] initData: ${initData.replace(/hash=[^&]*/, "hash=HIDDEN").replace(/signature=[^&]*/, "signature=HIDDEN")}`);
    
    if (!hash) {
      console.log(`[TelegramAuth] Validation failed: missing 'hash' parameter`);
      return { isValid: false };
    }

    // Explicitly delete ONLY hash from params before sorting
    urlParams.delete('hash');

    const params = Array.from(urlParams.entries());
    params.sort((a, b) => a[0].localeCompare(b[0]));
    
    const dataCheckString = params.map(([key, value]) => `${key}=${value}`).join('\n');
    
    console.log(`[TelegramAuth] Keys used for dataCheckString: [${params.map(p => p[0]).join(', ')}]`);
    console.log(`[TelegramAuth] dataCheckString:\n---\n${dataCheckString}\n---`);

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    
    if (calculatedHash !== hash) {
      console.log(`[TelegramAuth] Validation failed: hash mismatch`);
      console.log(`[TelegramAuth] Expected (calculated): ${calculatedHash}`);
      console.log(`[TelegramAuth] Received (hash param): ${hash}`);
      return { isValid: false };
    }

    const userString = urlParams.get('user');
    let user: TelegramUserData | undefined;
    if (userString) {
      try {
        user = JSON.parse(userString);
      } catch (e) {
        console.log(`[TelegramAuth] Failed to parse 'user' JSON string:`, userString);
        return { isValid: false };
      }
    } else {
      console.log(`[TelegramAuth] 'user' parameter is missing`);
    }

    console.log(`[TelegramAuth] Validation successful. User: ${user?.id}`);
    console.log(`--- [TelegramAuth DEBUG END] ---\n`);
    return { isValid: true, user };
  } catch (error) {
    console.error('[validateTelegramWebAppData] Error parsing initData:', error);
    return { isValid: false };
  }
}
