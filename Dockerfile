# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm@9

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY prisma ./prisma
RUN pnpm prisma generate

COPY src ./src
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
RUN pnpm build && pnpm prune --prod --ignore-scripts

# Production stage
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache openssl && npm install -g prisma@6.19.2

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

EXPOSE 3001

CMD ["sh", "-c", "prisma migrate deploy && node dist/main.js"]
