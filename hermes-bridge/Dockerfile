# hermes-bridge-prep — one-shot: builds node_modules for bridge.mjs, then
# copies itself into a shared volume for the actual hermes-bridge service to
# run from.
#
# The bridge needs a working `hermes` CLI on PATH, and that CLI is a Python
# entry-point script requiring python3.11 + the hermes_cli package (see
# hermes-agent-hermes:latest) — a plain node:22-alpine runtime can't satisfy
# that even if the script itself is extracted. So bridge.mjs doesn't run in
# an image built from this Dockerfile; it runs directly inside
# hermes-agent-hermes:latest (via `image:` in docker-compose.yaml, same
# proven pattern as hermes-dashboard — no `docker build`, so the "local-only
# image can't be a build FROM source under --pull" problem never applies),
# which already has both Node and the real hermes CLI native. This image's
# only job is to prepare bridge.mjs + its node_modules (pg is pure JS, so
# it's portable across the Node runtimes in both images).
FROM node:22-alpine AS build

WORKDIR /app
COPY package*.json ./
# No package-lock.json ships in hermes-bridge/ (single dependency), so `npm
# ci` has nothing to install from — use `npm install` instead.
RUN npm install --omit=dev
COPY bridge.mjs ./

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app ./
CMD ["sh", "-c", "cp -r /app/. /shared/ && echo 'hermes-bridge app copied to shared volume'"]
