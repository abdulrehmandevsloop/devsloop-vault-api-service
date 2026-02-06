# ============================================================
# Stage 1: Builder
# Install ALL deps, generate Prisma client, compile TypeScript
# ============================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@10

# Install ALL dependencies (dev + prod)
# husky is available here, so the "prepare" lifecycle script works fine
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Generate Prisma client (needs prisma CLI from devDependencies)
COPY prisma ./prisma
RUN pnpm prisma generate

# Copy source and config, then build
COPY src ./src
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
RUN pnpm build

# ============================================================
# Stage 2: Production Dependencies
# Clean install of ONLY production packages + Prisma client
# ============================================================
FROM node:20-alpine AS deps

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@10

# Install production dependencies only
# --ignore-scripts: prevents "prepare" script from running husky (a devDep)
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Generate Prisma client into the prod @prisma/client package
# prisma CLI is a devDep (not installed), so use pnpm dlx to run it on-the-fly
# Pin to v6 to match @prisma/client version (v7 has breaking schema changes)
RUN pnpm dlx prisma@6 generate

# ============================================================
# Stage 3: Runtime
# Minimal production image for Cloud Run
# ============================================================
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# OpenSSL is required by Prisma query engine on Alpine
RUN apk add --no-cache openssl

# Copy production node_modules (with generated Prisma client)
COPY --from=deps /app/node_modules ./node_modules

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Copy package.json and prisma schema (needed for runtime migrations)
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE 8080

CMD ["node", "dist/src/main.js"]
