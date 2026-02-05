# Build stage
# FROM node:20-alpine AS builder
# WORKDIR /app

# RUN npm install -g pnpm@10

# COPY package.json pnpm-lock.yaml ./
# RUN pnpm install --frozen-lockfile

# COPY prisma ./prisma
# RUN pnpm prisma generate

# COPY src ./src
# COPY tsconfig.json tsconfig.build.json nest-cli.json ./
# RUN pnpm build && pnpm prune --prod --ignore-scripts

# # Production stage
# FROM node:20-alpine
# WORKDIR /app

# ENV NODE_ENV=production

# RUN apk add --no-cache openssl && npm install -g prisma@6.19.2

# COPY --from=builder /app/node_modules ./node_modules
# COPY --from=builder /app/prisma ./prisma
# COPY --from=builder /app/dist ./dist
# COPY --from=builder /app/package.json ./

# EXPOSE 8080

# CMD ["node", "dist/main.js"]
# CMD ["sh", "-c", "prisma migrate deploy && node dist/main.js"]
# Stage 1: Build
FROM node:20-alpine AS builder

# Install pnpm
RUN npm install -g pnpm@10

WORKDIR /app

# Install dependencies first (better caching)
COPY package.json pnpm-lock.yaml ./
# We need devDeps to build the project
RUN pnpm install --frozen-lockfile

# Copy Prisma schema and generate client
# Doing this before copying source code saves time if only code changes
COPY prisma ./prisma/
RUN pnpm prisma generate

# Copy source and build
COPY . .
RUN pnpm build

# Remove development dependencies
RUN pnpm prune --prod --ignore-scripts

# Stage 2: Runtime
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Prisma requires openssl in Alpine
RUN apk add --no-cache openssl

# Copy only the necessary files from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

# Cloud Run uses the PORT env var, but we expose 8080 as a standard
EXPOSE 8080

# Use a non-root user for security (Alpine has a 'node' user by default)
USER node

# Start the application
CMD ["node", "dist/main.js"]