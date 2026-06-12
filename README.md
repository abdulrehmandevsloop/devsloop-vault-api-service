# DevsLoop Vault - Backend

Backend API for DevsLoop Vault, an internal knowledge management platform built with NestJS and Prisma.

## Tech Stack

- NestJS 11
- Prisma ORM 6
- PostgreSQL
- TypeScript 5

## Requirements

- Node.js 18 or higher
- pnpm
- PostgreSQL 14+

Deployments and pipelines are being handled on jenkins

## Local Development Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` and update the `DATABASE_URL` with your PostgreSQL credentials:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/devsloop_vault?schema=public"
```

### 3. Create the database

Make sure PostgreSQL is running, then create the database:

```bash
# Using psql
psql -U postgres -c "CREATE DATABASE devsloop_vault;"
```

### 4. Run database migrations

```bash
# Generate Prisma client
pnpm prisma:generate

# Run migrations
pnpm prisma:migrate
```

### 5. Seed the database (optional)

```bash
pnpm prisma:seed
```

### 6. Start the development server

```bash
pnpm start:dev
```

The API will be available at [http://localhost:3000](http://localhost:3000)

## Available Commands

```bash
# Development
pnpm start:dev          # Start in watch mode
pnpm start:debug        # Start with debugger

# Production
pnpm build              # Build for production
pnpm start:prod         # Run production build

# Database
pnpm prisma:generate    # Generate Prisma client
pnpm prisma:migrate     # Run migrations
pnpm prisma:seed        # Seed database
pnpm prisma:studio      # Open Prisma Studio
pnpm prisma:reset       # Reset database (drops all data)
pnpm db:setup           # Full setup (generate + migrate + seed)

# Testing
pnpm test               # Run unit tests
pnpm test:e2e           # Run e2e tests
pnpm test:cov           # Run tests with coverage

# Code Quality
pnpm lint               # Run ESLint
pnpm format             # Format code with Prettier
```

## Database Schema

### Entities

| Entity          | Description                                                |
| --------------- | ---------------------------------------------------------- |
| User            | Platform users with roles (Employee, Team Lead, Admin)     |
| Project         | Client projects with tech stack and confidentiality levels |
| Contribution    | Knowledge entries documenting work done on projects        |
| Tag             | Categorized tags for contributions (Tech, Skill, Domain)   |
| ContributionTag | Many-to-many relation between contributions and tags       |
| Bookmark        | User bookmarks for contributions                           |
| AuditLog        | Tracks all changes to entities                             |

### Entity Relationships

```
User 1──* Contribution (author)
User 1──* Contribution (reviewer)
User 1──* Bookmark
User 1──* AuditLog

Project 1──* Contribution

Contribution *──* Tag (via ContributionTag)
Contribution 1──* Bookmark
```

## Project Structure

```
backend/
├── prisma/
│   ├── schema.prisma     # Database schema
│   └── seed.ts           # Seed data
├── src/
│   ├── prisma/           # Prisma module
│   │   ├── prisma.module.ts
│   │   ├── prisma.service.ts
│   │   └── index.ts
│   ├── app.module.ts     # Root module
│   ├── app.controller.ts
│   ├── app.service.ts
│   └── main.ts           # Entry point
├── test/                 # E2E tests
├── .env.example          # Environment template
└── package.json
```

## Quick Start (All-in-One)

```bash
# Install, setup database, and start
pnpm install
cp .env.example .env
# Edit .env with your database credentials
pnpm db:setup
pnpm start:dev
```
