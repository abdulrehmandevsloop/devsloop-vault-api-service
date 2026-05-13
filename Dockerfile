# ============================================================
# Stage 1 — Dependencies + Prisma
# ============================================================
FROM node:22-alpine AS deps

WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma

# Install only what is needed for build
RUN pnpm install --frozen-lockfile

# Generate Prisma client (separate layer is fine)
RUN pnpm prisma generate


# ============================================================
# Stage 2 — Build
# ============================================================
FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# IMPORTANT: limit memory for 1GB VPS
ENV NODE_OPTIONS="--max-old-space-size=768"

# Faster + safer build
RUN pnpm build


# ============================================================
# Stage 3 — Production Runner (LEAN)
# ============================================================
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV PORT=3001

RUN addgroup -S nodejs && adduser -S nestjs -G nodejs

# Copy only compiled output (NO full node_modules recommended)
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./package.json

# Install only production deps in runtime (cleaner + smaller memory usage)
RUN corepack enable && corepack prepare pnpm@10 --activate && \
    pnpm install --prod --frozen-lockfile

USER nestjs

EXPOSE 3001

CMD ["node", "dist/src/main.js"]