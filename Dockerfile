FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/game-core/package.json packages/game-core/package.json
RUN npm ci
COPY apps apps
COPY packages packages
COPY tools tools
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS server
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/packages ./packages
COPY package*.json ./
COPY db ./db
COPY --chown=node:node data ./data
RUN mkdir -p /app/storage/assets /app/storage/avatars /app/storage/generated && chown -R node:node /app/storage
USER node
EXPOSE 3000
CMD ["sh", "-c", "node dist/tools/migrate.js && exec node dist/apps/server/src/main.js"]

FROM caddy:2 AS frontend
COPY --from=build /app/apps/web/dist /srv/site
COPY deploy/Caddyfile /etc/caddy/Caddyfile
