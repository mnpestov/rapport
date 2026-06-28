import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[Config] Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  botToken: requireEnv('BOT_TOKEN'),
  healthPort: parseInt(process.env.HEALTH_PORT ?? '3001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  telegramApiRoot: process.env.TELEGRAM_GATEWAY_BASE_URL ?? 'https://api.telegram.org',
};
