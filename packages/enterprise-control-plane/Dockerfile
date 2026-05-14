FROM node:20-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/vaultproof-core/package.json packages/vaultproof-core/package.json
COPY packages/enterprise-control-plane/package.json packages/enterprise-control-plane/package.json
RUN npm ci

FROM node:20-bookworm-slim AS prod-deps
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/vaultproof-core/package.json packages/vaultproof-core/package.json
COPY packages/enterprise-control-plane/package.json packages/enterprise-control-plane/package.json
RUN npm ci --omit=dev

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build --workspace @vaultproof/core
RUN npm run build --workspace @vaultproof/enterprise-control-plane
RUN find packages/vaultproof-core/dist packages/enterprise-control-plane/dist -type f \( -name '*.d.ts' -o -name '*.map' \) -delete

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/packages/vaultproof-core/dist ./packages/vaultproof-core/dist
COPY --from=build /app/packages/vaultproof-core/package.json ./packages/vaultproof-core/package.json
COPY --from=build /app/packages/enterprise-control-plane/dist ./packages/enterprise-control-plane/dist
COPY --from=build /app/packages/enterprise-control-plane/package.json ./packages/enterprise-control-plane/package.json
COPY --from=build /app/packages/enterprise-control-plane/static/control.html ./packages/enterprise-control-plane/static/control.html
COPY --from=build /app/packages/enterprise-control-plane/static/org.html ./packages/enterprise-control-plane/static/org.html
COPY --from=build /app/apps/site/js/app-login-3.js ./apps/site/js/app-login-3.js

USER node
EXPOSE 3001
CMD ["node", "packages/enterprise-control-plane/dist/enterprise-control-plane/src/server.js"]
