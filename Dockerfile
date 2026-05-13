# ============================================================
# Stage 1 — Dependencies
# ============================================================
FROM node:22-alpine AS deps

RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma

# Install ALL deps (needed for Prisma generate)
RUN pnpm install --frozen-lockfile

# Generate Prisma client
RUN pnpm prisma generate


# ============================================================
# Stage 2 — Build
# ============================================================
FROM node:22-alpine AS builder

RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

# Copy deps from previous stage
COPY --from=deps /app/node_modules ./node_modules

# Copy full source
COPY . .

# Build NestJS app
RUN pnpm build


# ============================================================
# Stage 3 — Production Runner
# ============================================================
FROM node:22-alpine AS runner

RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup -S nodejs && adduser -S nestjs -G nodejs

# Copy only required production files
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./

USER nestjs

EXPOSE 3001

CMD ["node", "dist/src/main.js"]