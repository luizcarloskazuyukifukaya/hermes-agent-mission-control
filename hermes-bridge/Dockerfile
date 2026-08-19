# hermes-bridge — containerized for V-Decent / Coolify deployment.
# Polls Postgres and drives the `hermes` CLI (extracted at runtime into a
# shared volume by the hermes-cli-extract service, since the hermes-agent
# image is local-only on this host and can't be resolved as a build FROM
# source by `docker compose build`).
FROM node:22-alpine

WORKDIR /app

# git: bridge.mjs commits wiki changes with `git -C $HERMES_WIKI ...`
RUN apk add --no-cache git

COPY package*.json ./
# No package-lock.json ships in hermes-bridge/ (single dependency), so `npm
# ci` has nothing to install from — use `npm install` instead.
RUN npm install --omit=dev

COPY bridge.mjs ./

USER node

CMD ["node", "bridge.mjs"]
