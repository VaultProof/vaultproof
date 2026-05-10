FROM node:20-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/vaultproof-core/package.json packages/vaultproof-core/package.json
COPY packages/enterprise-secure-executor/package.json packages/enterprise-secure-executor/package.json
RUN npm ci

FROM node:20-bookworm-slim AS prod-deps
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/vaultproof-core/package.json packages/vaultproof-core/package.json
COPY packages/enterprise-secure-executor/package.json packages/enterprise-secure-executor/package.json
RUN npm ci --omit=dev

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build --workspace @vaultproof/core
RUN npm run build --workspace @vaultproof/enterprise-secure-executor
RUN find packages/vaultproof-core/dist packages/enterprise-secure-executor/dist -type f \( -name '*.d.ts' -o -name '*.map' \) -delete

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/packages/vaultproof-core/dist ./packages/vaultproof-core/dist
COPY --from=build /app/packages/vaultproof-core/package.json ./packages/vaultproof-core/package.json
COPY --from=build /app/packages/enterprise-secure-executor/dist ./packages/enterprise-secure-executor/dist
COPY --from=build /app/packages/enterprise-secure-executor/package.json ./packages/enterprise-secure-executor/package.json

USER node
EXPOSE 3002
CMD ["node", "packages/enterprise-secure-executor/dist/enterprise-secure-executor/src/server.js"]
