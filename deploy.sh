#!/bin/bash
set -e

cd /var/www/rapport
git pull
cd /var/www/rapport/apps/backend
pnpm prisma migrate deploy
cd /var/www/rapport
pnpm install
pnpm build
pm2 restart rapport-api
pm2 restart rapport-support-bot --update-env
