import 'dotenv/config';
import http from 'http';
import { config } from './config';
import { logEvent } from './logger';
import { createBot } from './bot/bot';

function startHealthServer(): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(config.healthPort, () => {
    logEvent({ event: 'HEALTH_SERVER_STARTED', port: config.healthPort });
  });
  return server;
}

async function main(): Promise<void> {
  logEvent({
    event: 'STARTUP',
    service: 'support-bot',
    nodeEnv: config.nodeEnv,
    mode: 'long-polling',
    botTokenLoaded: config.botToken.length > 0,
  });

  const healthServer = startHealthServer();
  const bot = createBot();

  process.once('SIGINT', () => {
    logEvent({ event: 'SHUTDOWN', signal: 'SIGINT' });
    void bot.stop();
    healthServer.close();
  });
  process.once('SIGTERM', () => {
    logEvent({ event: 'SHUTDOWN', signal: 'SIGTERM' });
    void bot.stop();
    healthServer.close();
  });

  await bot.start({
    onStart: (botInfo) => {
      logEvent({
        event: 'BOT_STARTED',
        username: botInfo.username,
        id: botInfo.id,
        mode: 'long-polling',
      });
    },
  });
}

main().catch((err) => {
  const error = err instanceof Error ? err : new Error(String(err));
  logEvent({
    event: 'ERROR',
    errorName: error.name,
    errorMessage: error.message,
    stack: error.stack ?? null,
    fatal: true,
  });
  process.exit(1);
});
