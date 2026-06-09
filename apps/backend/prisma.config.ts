import { defineConfig } from '@prisma/config';
import 'dotenv/config'; // Убедимся что загружаются env переменные

export default defineConfig({
  earlyAccess: true,
  datasource: {
    url: process.env.DATABASE_URL
  }
});
