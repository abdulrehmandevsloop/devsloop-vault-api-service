# ============================================================
# Stage 1 — All deps (dev+prod) for building
# ============================================================
FROM node:22-alpine AS deps

WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma

RUN pnpm install --frozen-lockfile

RUN pnpm prisma generate

# ============================================================
# Stage 2 — Prod-only deps for runtime
# ============================================================
FROM node:22-alpine AS prod-deps

WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma

RUN pnpm install --frozen-lockfile --prod --ignore-scripts

RUN pnpm dlx prisma@6 generate

# ============================================================
# Stage 3 — Build
# ============================================================
FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_OPTIONS="--max-old-space-size=768"

RUN pnpm build

# ============================================================
# Stage 4 — Production Runner
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
COPY --from=builder --chown=nestjs:nodejs /app/pnpm-lock.yaml ./pnpm-lock.yaml

# `prepare` runs husky; husky is not installed with --prod, so drop prepare for this image only.
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));if(p.scripts&&p.scripts.prepare)delete p.scripts.prepare;fs.writeFileSync('package.json',JSON.stringify(p,null,2)+String.fromCharCode(10));"

RUN corepack enable && corepack prepare pnpm@10 --activate && \
    HUSKY=0 pnpm install --prod --frozen-lockfile

USER nestjs

EXPOSE 3001

CMD ["node", "dist/src/main.js"]
