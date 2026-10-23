# Local, single-container Pollinator. See compose.yaml.
FROM node:22-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN node scripts/build.mjs local \
 && cp "node_modules/@beeai/cli/dist/platforms/linux-$(node -p process.arch)/bee" /src/bee

FROM node:22-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/dist/local ./dist/local
COPY --from=build /src/web ./web
COPY --from=build --chmod=755 /src/bee ./bin/bee
RUN mkdir -p /app/.data && chown node:node /app/.data
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    POLLINATOR_ROOT=/app \
    BEE_CLI_BINARY=/app/bin/bee
USER node
EXPOSE 8787
CMD ["node", "dist/local/server.mjs"]
