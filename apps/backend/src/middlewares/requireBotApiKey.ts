import { Request, Response, NextFunction } from 'express';

export function requireBotApiKey(req: Request, res: Response, next: NextFunction): void {
  const expectedKey = process.env.BOT_API_KEY;
  if (!expectedKey) {
    console.error('[requireBotApiKey] BOT_API_KEY is not configured');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }
  if (req.headers['x-bot-api-key'] !== expectedKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
