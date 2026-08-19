#!/bin/sh
echo "DEBUG DATABASE_URL (redacted): $(echo "$DATABASE_URL" | sed -E 's#(postgresql://[^:]+):[^@]+@#\1:REDACTED@#')"
npx prisma db push --skip-generate --accept-data-loss || echo "DEBUG: prisma db push failed, starting server anyway for debugging"
exec node node_modules/.bin/next start
