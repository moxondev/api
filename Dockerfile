# syntax=docker/dockerfile:1

ARG NODE_VERSION=22

# tsc runs on the build machine, whatever the target platform
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm rebuild canvas

FROM node:${NODE_VERSION}-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    XDG_CACHE_HOME=/tmp/.cache

# Fonts and their cache are built now, the filesystem is read-only at runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core tini \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json robots.txt ./

USER node
EXPOSE 3000

# No curl in the slim image, so the check runs on Node
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/app.js"]
