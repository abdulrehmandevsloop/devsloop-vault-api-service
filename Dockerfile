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

# node_modules from deps stage (prod only, no reinstall needed)
COPY --from=deps    --chown=nestjs:nodejs /app/node_modules ./node_modules

# Compiled app + schema
COPY --from=builder --chown=nestjs:nodejs /app/dist        ./dist
COPY --from=builder --chown=nestjs:nodejs /app/prisma      ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./package.json

USER nestjs

EXPOSE 3001

CMD ["node", "dist/src/main.js"]