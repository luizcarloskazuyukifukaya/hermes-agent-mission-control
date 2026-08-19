#!/bin/sh
set -e
npx prisma db push --skip-generate --accept-data-loss
exec node node_modules/.bin/next start
