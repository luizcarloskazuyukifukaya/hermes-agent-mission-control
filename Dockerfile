# Hermy HQ — Dockerfile for V-Decent / Coolify deployment
# Multi-stage: build -> production image
# Healthcheck on /api/hermes/health (requires x-internal-secret: the global
# middleware in src/middleware.ts 401s every /api/* route without either a
# NextAuth session or that header)

# --- Build stage ---
FROM node:22-alpine AS builder

WORKDIR /app

# better-sqlite3 (a transitive dep) needs python/make/g++ to build from source
RUN apk add --no-cache python3 make g++ git

# Build-time inlined vars (Next.js NEXT_PUBLIC_*)
ARG NEXT_PUBLIC_OWNER_NAME
ARG NEXT_PUBLIC_BASE_URL
ENV NEXT_PUBLIC_OWNER_NAME=${NEXT_PUBLIC_OWNER_NAME} \
    NEXT_PUBLIC_BASE_URL=${NEXT_PUBLIC_BASE_URL}

# Copy package files + prisma schema first (postinstall runs `prisma generate`,
# which needs prisma/ present), then install.
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# --- Production stage ---
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache curl dumb-init

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma/
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS -H "x-internal-secret: $INTERNAL_API_SECRET" http://localhost:3000/api/hermes/health || exit 1

EXPOSE 3000

USER node

ENTRYPOINT ["dumb-init", "--"]
# Auto-sync Prisma schema on boot, then start the server. --accept-data-loss
# is safe here: this is a brand-new database with no rows to lose, and there
# is no TTY in the automated deploy pipeline to answer a confirmation prompt.
CMD ["./docker-entrypoint.sh"]
