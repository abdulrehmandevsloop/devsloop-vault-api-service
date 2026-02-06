# DevsLoop Vault - Project Architecture

**Version**: 2.0  
**Last Updated**: February 4, 2026  
**Backend Framework**: NestJS 11.x  
**Frontend Framework**: Next.js 16.x  
**Database**: PostgreSQL (Prisma ORM)  
**Queue**: pg-boss (PostgreSQL-based)

---

## Table of Contents

1. [Overview](#overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Module Architecture](#module-architecture)
5. [Event-Driven Architecture](#event-driven-architecture)
6. [Background Job Processing](#background-job-processing)
7. [Caching Strategy](#caching-strategy)
8. [API Design](#api-design)
9. [Security Architecture](#security-architecture)
10. [Access Control System (ACL)](#access-control-system-acl)
11. [Infrastructure](#infrastructure)
12. [Frontend Architecture](#frontend-architecture)
13. [Development Workflow](#development-workflow)

---

## Overview

DevsLoop Vault is an **Internal Knowledge Management Platform** for capturing and sharing project learnings. The architecture follows **event-driven patterns** with **PostgreSQL-based job processing** and **in-memory caching** for optimal performance.

### Key Architectural Principles

- **Modular Design** - Clear domain boundaries with NestJS modules
- **Event-Driven** - Decoupled service communication via event emitter
- **Async Processing** - Background jobs via pg-boss (PostgreSQL-based)
- **Entity-Based ACL** - Fine-grained access control without role hierarchy
- **In-Memory Caching** - Performance optimization without external Redis
- **API Versioning** - Future-proof API design with `/api/v1` prefix
- **Health Monitoring** - Production-ready observability

---

## Technology Stack

### Backend Core

| Technology | Version | Purpose                                    |
| ---------- | ------- | ------------------------------------------ |
| NestJS     | 11.x    | Progressive Node.js framework              |
| TypeScript | 5.9.x   | Type-safe development                      |
| Express    | 5.x     | HTTP server (via @nestjs/platform-express) |

### Database & ORM

| Technology     | Version | Purpose             |
| -------------- | ------- | ------------------- |
| PostgreSQL     | 15+     | Primary database    |
| Prisma         | 6.19.x  | Type-safe ORM       |
| Prisma Migrate | -       | Database migrations |

### Queue & Caching

| Technology       | Version | Purpose                       |
| ---------------- | ------- | ----------------------------- |
| pg-boss          | 10.4.x  | PostgreSQL-based job queue    |
| cache-manager    | 7.x     | In-memory caching abstraction |
| @nestjs/schedule | 6.x     | Cron job scheduling           |

### Authentication & Security

| Technology        | Version | Purpose                   |
| ----------------- | ------- | ------------------------- |
| @nestjs/jwt       | 11.x    | JWT token handling        |
| @nestjs/passport  | 11.x    | Authentication middleware |
| passport-jwt      | 4.x     | JWT strategy              |
| bcryptjs          | 3.x     | Password hashing          |
| helmet            | 8.x     | Security headers          |
| @nestjs/throttler | 6.x     | Rate limiting             |

### Event System

| Technology            | Version | Purpose             |
| --------------------- | ------- | ------------------- |
| @nestjs/event-emitter | 3.x     | In-memory event bus |

### Email

| Technology | Version | Purpose        |
| ---------- | ------- | -------------- |
| nodemailer | 7.x     | Email delivery |

### Monitoring & Logging

| Technology       | Version | Purpose                |
| ---------------- | ------- | ---------------------- |
| @nestjs/terminus | 11.x    | Health check endpoints |
| nestjs-pino      | 4.x     | Structured logging     |
| pino-pretty      | 13.x    | Log formatting         |

### Frontend Core

| Technology   | Version | Purpose               |
| ------------ | ------- | --------------------- |
| Next.js      | 16.x    | React framework       |
| React        | 19.x    | UI library            |
| TypeScript   | 5.x     | Type-safe development |
| Tailwind CSS | 4.x     | Utility-first styling |

### Frontend State & Forms

| Technology      | Version | Purpose                  |
| --------------- | ------- | ------------------------ |
| Redux Toolkit   | 2.x     | State management         |
| React Redux     | 9.x     | React bindings for Redux |
| React Hook Form | 7.x     | Form handling            |
| Zod             | 4.x     | Schema validation        |

### Frontend UI Components

| Technology      | Version | Purpose                  |
| --------------- | ------- | ------------------------ |
| Radix UI        | -       | Accessible UI primitives |
| Lucide React    | -       | Icon library             |
| React Quill New | 3.x     | Rich text editor         |
| TanStack Table  | 8.x     | Data tables              |

### Development Tools

| Tool            | Purpose                |
| --------------- | ---------------------- |
| ESLint          | Code linting           |
| Prettier        | Code formatting        |
| Husky           | Git hooks              |
| lint-staged     | Pre-commit linting     |
| commitlint      | Commit message linting |
| Jest            | Testing framework      |
| Swagger/OpenAPI | API documentation      |

---

## Project Structure

### Backend Directory Structure

```
backend/
├── prisma/
│   ├── schema.prisma          # Database schema (ACL models included)
│   ├── migrations/            # Database migrations
│   └── seed.ts               # Database seeding
├── src/
│   ├── app.module.ts         # Root module
│   ├── main.ts               # Application entry point
│   │
│   ├── auth/                 # Authentication & Authorization
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── dto/              # DTOs (login, register, reset-password, etc.)
│   │   ├── events/           # Domain events (7 events)
│   │   ├── listeners/        # Event handlers (email, audit)
│   │   ├── services/         # Supporting services
│   │   │   ├── token.service.ts
│   │   │   ├── token-cleanup.service.ts
│   │   │   ├── audit-log.service.ts
│   │   │   ├── email-verification.service.ts
│   │   │   └── password-reset.service.ts
│   │   ├── strategies/
│   │   │   └── jwt.strategy.ts
│   │   └── interfaces/
│   │
│   ├── users/                # User Management
│   │   ├── users.module.ts
│   │   ├── users.controller.ts
│   │   ├── users.service.ts
│   │   ├── dto/
│   │   ├── events/           # Domain events (3 events)
│   │   ├── listeners/
│   │   └── services/
│   │       ├── user-query.service.ts
│   │       └── user-validation.service.ts
│   │
│   ├── contributions/        # Contribution Management
│   │   ├── contributions.module.ts
│   │   ├── contributions.controller.ts
│   │   ├── contributions.service.ts
│   │   ├── dto/              # Full DTOs for CRUD and review workflow
│   │   ├── events/           # Domain events (3 events)
│   │   ├── listeners/
│   │   └── services/
│   │       └── contribution-validation.service.ts
│   │
│   ├── projects/             # Project Management
│   │   ├── projects.module.ts
│   │   ├── projects.controller.ts
│   │   ├── projects.service.ts
│   │   └── dto/
│   │
│   ├── user-projects/        # User-Project Assignments
│   │   ├── user-projects.module.ts
│   │   ├── user-projects.controller.ts
│   │   ├── user-projects.service.ts
│   │   └── dto/
│   │
│   ├── rbac/                 # Access Control (ACL/RBAC)
│   │   ├── rbac.module.ts
│   │   ├── rbac.controller.ts  # ACL endpoints
│   │   ├── roles.controller.ts # Role management
│   │   ├── rbac.service.ts
│   │   └── dto/
│   │
│   ├── reviews/              # Review System (Scaffolded)
│   │   ├── reviews.module.ts
│   │   └── reviews.service.ts
│   │
│   ├── notifications/        # Notification System (Scaffolded)
│   │   ├── notifications.module.ts
│   │   └── notifications.service.ts
│   │
│   ├── audit/                # Audit Logging
│   │   ├── audit.module.ts
│   │   └── audit.service.ts
│   │
│   ├── common/               # Shared Code
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts
│   │   │   ├── public.decorator.ts
│   │   │   ├── roles.decorator.ts
│   │   │   ├── allow-pending.decorator.ts
│   │   │   ├── require-email-verified.decorator.ts
│   │   │   └── require-entity.decorator.ts
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   ├── roles.guard.ts
│   │   │   ├── entity-access.guard.ts
│   │   │   ├── email-verified.guard.ts
│   │   │   └── throttle.guard.ts
│   │   ├── interceptors/
│   │   │   └── logging.interceptor.ts
│   │   ├── pipes/
│   │   │   └── cuid-validation.pipe.ts
│   │   ├── processors/       # Background job processors
│   │   │   ├── email.processor.ts
│   │   │   └── audit.processor.ts
│   │   └── dto/
│   │       ├── pagination.dto.ts
│   │       └── standard-response.dto.ts
│   │
│   ├── queue/                # Queue Module (pg-boss)
│   │   ├── queue.module.ts
│   │   ├── pg-boss.module.ts
│   │   └── pg-boss.service.ts
│   │
│   ├── health/               # Health Check Module
│   │   ├── health.module.ts
│   │   ├── health.controller.ts
│   │   └── prisma.health.ts
│   │
│   ├── config/               # Configuration
│   │   ├── configuration.ts
│   │   └── configuration.schema.ts
│   │
│   └── prisma/               # Database Module
│       ├── prisma.module.ts
│       └── prisma.service.ts
│
├── docker-compose.yml        # Infrastructure setup
├── Dockerfile               # Production container
├── cloudbuild.yaml          # GCP Cloud Build config
├── .env.example             # Environment variables template
├── package.json             # Dependencies
└── tsconfig.json            # TypeScript configuration
```

### Frontend Directory Structure

```
frontend/
├── app/
│   ├── (auth)/               # Auth routes (layout group)
│   │   ├── layout.tsx
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   ├── forgot-password/page.tsx
│   │   ├── reset-password/page.tsx
│   │   └── verify-email/page.tsx
│   ├── (dashboard)/          # Dashboard routes (layout group)
│   │   ├── layout.tsx
│   │   ├── dashboard/page.tsx
│   │   ├── contributions/
│   │   │   ├── page.tsx
│   │   │   ├── new/page.tsx
│   │   │   └── [id]/
│   │   │       ├── page.tsx
│   │   │       └── edit/page.tsx
│   │   ├── review-contributions/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── projects/page.tsx
│   │   ├── roles/page.tsx
│   │   ├── user-management/page.tsx
│   │   └── settings/page.tsx
│   ├── layout.tsx            # Root layout
│   ├── page.tsx              # Landing page
│   ├── globals.css           # Global styles
│   └── error.tsx             # Error boundary
│
├── components/
│   ├── layout/               # Layout components
│   │   ├── header.tsx
│   │   ├── sidebar.tsx
│   │   └── mobile-sidebar.tsx
│   ├── providers/            # Context providers
│   │   └── theme-provider.tsx
│   ├── shared/               # Shared components
│   │   ├── page-header.tsx
│   │   ├── stats-card.tsx
│   │   ├── empty-state.tsx
│   │   └── ...
│   └── ui/                   # UI primitives
│       ├── button.tsx
│       ├── card.tsx
│       ├── dialog.tsx
│       ├── form.tsx
│       ├── data-table.tsx
│       ├── rich-text-editor.tsx
│       └── ...
│
├── hooks/                    # Custom hooks
│   ├── use-auth.ts
│   ├── use-debounce.ts
│   └── use-toast.ts
│
├── lib/
│   ├── api/                  # API clients
│   │   ├── baseApi.ts
│   │   ├── authApi.ts
│   │   ├── adminApi.ts
│   │   └── contributionApi.ts
│   ├── auth/
│   │   └── tokens.ts
│   ├── constants/
│   │   ├── entities.ts
│   │   └── roles.ts
│   ├── store/                # Redux store
│   │   ├── store.ts
│   │   ├── hooks.ts
│   │   └── slices/
│   │       ├── authSlice.ts
│   │       └── serverStatusSlice.ts
│   ├── utils/
│   │   ├── permissions.ts
│   │   └── sanitize.ts
│   └── validations/          # Zod schemas
│       ├── auth.ts
│       ├── contribution.ts
│       ├── project.ts
│       └── role.ts
│
├── types/                    # TypeScript types
│   ├── api.ts
│   ├── common.ts
│   └── models.ts
│
├── public/                   # Static assets
├── Dockerfile               # Production container
├── cloudbuild.yaml          # GCP Cloud Build config
└── next.config.ts           # Next.js configuration
```

---

## Module Architecture

### Module Overview

The application consists of **13 modules**:

| Module                  | Purpose                                  | Status     |
| ----------------------- | ---------------------------------------- | ---------- |
| **AuthModule**          | Authentication, JWT, password management | Complete   |
| **UsersModule**         | User management, approval workflow       | Complete   |
| **ContributionsModule** | Contribution CRUD, review workflow       | Complete   |
| **ProjectsModule**      | Project management                       | Complete   |
| **UserProjectsModule**  | Admin assigns projects to users          | Complete   |
| **AclModule (RBAC)**    | Entity-based access control              | Complete   |
| **ReviewsModule**       | Review system                            | Scaffolded |
| **NotificationsModule** | Notification system                      | Scaffolded |
| **AuditModule**         | Audit logging                            | Complete   |
| **QueueModule**         | Background job processing (pg-boss)      | Complete   |
| **HealthModule**        | Health monitoring                        | Complete   |
| **PrismaModule**        | Database access                          | Complete   |
| **Common**              | Shared utilities, guards, decorators     | Complete   |

### Module Dependencies

```
AppModule
├── ConfigModule (global)
├── EventEmitterModule (global)
├── CacheModule (global, in-memory)
├── ThrottlerModule (global)
├── ScheduleModule (global)
├── PrismaModule
├── QueueModule (pg-boss)
│   ├── PgBossModule
│   ├── EmailProcessor
│   └── AuditProcessor
├── AuthModule
│   └── PrismaModule
├── UsersModule
│   ├── PrismaModule
│   └── AclService (from RBAC)
├── ContributionsModule
│   └── PrismaModule
├── ProjectsModule
│   └── PrismaModule
├── UserProjectsModule
│   └── PrismaModule
├── AclModule (RBAC)
│   ├── PrismaModule
│   └── QueueModule
├── ReviewsModule (scaffolded)
├── NotificationsModule (scaffolded)
├── AuditModule
└── HealthModule
    └── PrismaModule
```

### Global Guards (Applied in Order)

```typescript
// 1. JwtAuthGuard - Validates JWT token
// 2. RolesGuard - Checks legacy roles (ADMIN, TEAM_LEAD, EMPLOYEE)
// 3. EntityAccessGuard - Checks entity-based permissions (ACL)
// 4. EmailVerifiedGuard - Requires email verification for certain endpoints
```

---

## Event-Driven Architecture

### Event System Overview

The application uses **@nestjs/event-emitter** for in-memory event-driven communication.

### Event Flow Pattern

```
Service Action
    ↓
Emit Domain Event (async, non-blocking)
    ↓
Event Handlers (multiple listeners)
    ↓
Background Jobs (via pg-boss)
    ↓
Processors (email, audit, etc.)
```

### Domain Events

#### Auth Events (7 events)

| Event                             | Trigger                     |
| --------------------------------- | --------------------------- |
| `UserRegisteredEvent`             | User registration completed |
| `UserLoggedInEvent`               | User logged in successfully |
| `UserLoggedOutEvent`              | User logged out             |
| `PasswordResetRequestedEvent`     | Password reset requested    |
| `PasswordResetCompletedEvent`     | Password reset completed    |
| `PasswordChangedEvent`            | Password changed            |
| `VerificationEmailRequestedEvent` | Verification email resend   |

#### User Events (3 events)

| Event                    | Trigger                |
| ------------------------ | ---------------------- |
| `UserApprovedEvent`      | User approved by admin |
| `UserRejectedEvent`      | User rejected by admin |
| `UserStatusChangedEvent` | User access toggled    |

#### Contribution Events (3 events)

| Event                        | Trigger                           |
| ---------------------------- | --------------------------------- |
| `ContributionSubmittedEvent` | Contribution submitted for review |
| `ContributionApprovedEvent`  | Contribution approved by reviewer |
| `ContributionRejectedEvent`  | Contribution rejected by reviewer |

**Total: 13 domain events**

### Event Naming Convention

- **Past tense** - Events represent something that happened
- **Domain prefix** - `user.`, `contribution.`, `auth.`
- **Descriptive** - Clear and specific names

---

## Background Job Processing

### Queue Architecture

The application uses **pg-boss** (PostgreSQL-based queue) for background job processing. This eliminates the need for Redis.

### Queue Module

```typescript
@Module({
  imports: [ConfigModule, PrismaModule, PgBossModule],
  providers: [EmailProcessor, AuditProcessor],
  exports: [PgBossModule],
})
export class QueueModule {}
```

### Job Processors

#### EmailProcessor

- Handles email sending via Nodemailer
- Job types: `verification`, `password-reset`, `welcome`, `contribution-approved`, `contribution-rejected`
- Retry logic with exponential backoff

#### AuditProcessor

- Handles audit log creation
- Stores audit entries in database

### Benefits of pg-boss over Redis/Bull

- Single database dependency (PostgreSQL)
- No additional infrastructure needed
- Transaction support with Prisma
- Simpler deployment and maintenance

---

## Caching Strategy

### Cache Configuration

- **Backend**: In-memory (no Redis required)
- **TTL**: 5 minutes (configurable via `CACHE_TTL`)
- **Max Items**: 1000 items in memory
- **Scope**: Global (available to all modules)

```typescript
CacheModule.registerAsync({
  isGlobal: true,
  useFactory: (configService: ConfigService) => ({
    ttl: configService.get('CACHE_TTL', 300),
    max: 1000,
  }),
  inject: [ConfigService],
});
```

### Cache Usage Pattern

```typescript
// Check cache first
const cached = await this.cacheManager.get(cacheKey);
if (cached) return cached;

// Query database
const data = await this.prisma.model.findUnique(...);

// Store in cache
await this.cacheManager.set(cacheKey, data, 300);

return data;
```

---

## API Design

### API Versioning

- **Base URL**: `/api/v1`
- **Versioning Strategy**: URL-based versioning
- **Swagger Docs**: `/api/v1/docs`

### RESTful Endpoints

#### Authentication (`/api/v1/auth`)

| Method | Endpoint               | Description                       |
| ------ | ---------------------- | --------------------------------- |
| POST   | `/register`            | Register a new user               |
| POST   | `/login`               | Login user                        |
| POST   | `/refresh`             | Refresh access token              |
| POST   | `/logout`              | Logout user                       |
| GET    | `/me`                  | Get current user with permissions |
| POST   | `/verify-email`        | Verify email with token           |
| POST   | `/resend-verification` | Resend verification code          |
| POST   | `/forgot-password`     | Request password reset            |
| POST   | `/reset-password`      | Reset password with token         |
| POST   | `/change-password`     | Change password (authenticated)   |

#### Admin - Users (`/api/v1/admin/users`)

| Method | Endpoint       | Description                         |
| ------ | -------------- | ----------------------------------- |
| GET    | `/`            | Get all users (paginated, filtered) |
| GET    | `/pending`     | Get pending approval requests       |
| GET    | `/stats`       | Get approval statistics             |
| GET    | `/roles`       | Get roles for user assignment       |
| GET    | `/:id`         | Get user by ID                      |
| PATCH  | `/:id/approve` | Approve user with role assignment   |
| PATCH  | `/:id/reject`  | Reject user                         |
| PATCH  | `/:id/status`  | Toggle user access status           |

#### Admin - Projects (`/api/v1/admin/projects`)

| Method | Endpoint | Description                            |
| ------ | -------- | -------------------------------------- |
| POST   | `/`      | Create a new project                   |
| GET    | `/`      | Get all projects (paginated, filtered) |
| GET    | `/list`  | Get projects for dropdown              |
| GET    | `/:id`   | Get project by ID                      |
| PATCH  | `/:id`   | Update a project                       |
| DELETE | `/:id`   | Delete a project                       |

#### Admin - User Project Assignments (`/api/v1/admin/users/:userId/projects`)

| Method | Endpoint      | Description                   |
| ------ | ------------- | ----------------------------- |
| GET    | `/`           | Get projects assigned to user |
| POST   | `/`           | Set user assigned projects    |
| DELETE | `/:projectId` | Remove project assignment     |

#### Admin - ACL (`/api/v1/admin/acl`)

| Method | Endpoint                       | Description               |
| ------ | ------------------------------ | ------------------------- |
| POST   | `/roles`                       | Create a new role         |
| GET    | `/roles`                       | Get all roles (paginated) |
| GET    | `/roles/:id`                   | Get role by ID            |
| PATCH  | `/roles/:id`                   | Update a role             |
| DELETE | `/roles/:id`                   | Delete a role             |
| GET    | `/entities`                    | Get all entities          |
| POST   | `/users/:userId/roles`         | Assign role to user       |
| DELETE | `/users/:userId/roles/:roleId` | Remove role from user     |
| POST   | `/users/:userId/permissions`   | Grant ACL permissions     |
| DELETE | `/users/:userId/permissions`   | Revoke ACL permissions    |
| GET    | `/users/:userId/permissions`   | Get user ACL permissions  |

#### Contributions (`/api/v1/contributions`)

| Method | Endpoint               | Description                             |
| ------ | ---------------------- | --------------------------------------- |
| POST   | `/`                    | Create a new contribution (DRAFT)       |
| GET    | `/`                    | List contributions for reviewer         |
| GET    | `/my`                  | Get my contributions (paginated)        |
| GET    | `/reviewer`            | Get contributions for assigned reviewer |
| GET    | `/:id`                 | Get contribution by ID                  |
| PATCH  | `/:id`                 | Update a contribution (DRAFT only)      |
| DELETE | `/:id`                 | Delete a contribution                   |
| POST   | `/:id/submit`          | Submit for review                       |
| POST   | `/:id/revert-to-draft` | Revert rejected to draft                |
| PATCH  | `/:id/approve`         | Approve contribution                    |
| PATCH  | `/:id/reject`          | Reject contribution                     |

#### Health (`/api/v1/health`)

| Method | Endpoint     | Description       |
| ------ | ------------ | ----------------- |
| GET    | `/`          | Full health check |
| GET    | `/liveness`  | Liveness probe    |
| GET    | `/readiness` | Readiness probe   |

### Request/Response Format

#### Success Response (Paginated)

```json
{
  "data": [...],
  "total": 100,
  "page": 1,
  "limit": 10,
  "totalPages": 10,
  "hasNextPage": true,
  "hasPreviousPage": false
}
```

#### Error Response

```json
{
  "statusCode": 400,
  "timestamp": "2026-02-04T...",
  "path": "/api/v1/auth/login",
  "method": "POST",
  "message": "Invalid credentials"
}
```

---

## Security Architecture

### Authentication Flow

```
1. User registers → Email verification required
2. Admin approves user → Assigns role with entity permissions
3. User logs in → Receives JWT access token (15min) + refresh token (7 days)
4. Client includes token in Authorization header
5. JwtAuthGuard validates token
6. RolesGuard checks legacy role
7. EntityAccessGuard checks ACL permissions
8. EmailVerifiedGuard checks email verification (if required)
```

### Security Layers

| Layer             | Implementation                                       |
| ----------------- | ---------------------------------------------------- |
| HTTP Headers      | Helmet (security headers)                            |
| CORS              | Configured for frontend origin                       |
| Rate Limiting     | ThrottlerGuard (100 req/min global, 5 req/min login) |
| Input Validation  | ValidationPipe (whitelist, transform)                |
| Authentication    | JWT (access + refresh tokens)                        |
| Authorization     | Entity-based ACL                                     |
| Password Security | bcrypt (10 salt rounds)                              |
| SQL Injection     | Prisma ORM (parameterized queries)                   |

### Token Configuration

| Token              | Expiry     | Storage           |
| ------------------ | ---------- | ----------------- |
| Access Token       | 15 minutes | Client memory     |
| Refresh Token      | 7 days     | Database (hashed) |
| Email Verification | 24 hours   | Database          |
| Password Reset     | 1 hour     | Database          |

---

## Access Control System (ACL)

### Overview

The system uses **Entity-Based Access Control (EBAC)** where permissions are granted at the entity level, not through role hierarchy.

### Database Schema

```prisma
model Entity {
  id          String  @id @default(cuid())
  name        String  @unique // "user", "project", "contribution", etc.
  displayName String
  isActive    Boolean @default(true)
}

model Role {
  id          String  @id @default(cuid())
  name        String  @unique
  displayName String
  isSystem    Boolean @default(false)
  isActive    Boolean @default(true)
}

model RoleEntity {
  roleId   String
  entityId String
  // Role grants access to Entity
}

model AclEntry {
  userId   String
  entityId String
  // Direct user-entity permission
}
```

### Available Entities

| Entity Name           | Purpose                       |
| --------------------- | ----------------------------- |
| `user`                | User management               |
| `project`             | Project management            |
| `contribution`        | Create/edit own contributions |
| `contribution-review` | Review others' contributions  |
| `role`                | Role management               |

### Permission Check Flow

```
@RequireEntity('contribution')
    ↓
EntityAccessGuard
    ↓
Check: User has role with 'contribution' entity?
    OR
Check: User has direct ACL entry for 'contribution'?
    ↓
Allow / Deny
```

### User Approval Flow

```
1. User registers (PENDING status)
2. Admin reviews user
3. Admin approves with role assignment
   - Assigns role (e.g., "Employee")
   - Role has entity permissions (e.g., "contribution")
4. User can now access entities granted by role
```

### Project Assignment Flow

```
1. Admin creates project
2. Admin assigns projects to user via UserProject
3. User (with contribution-review entity) can review
   contributions for assigned projects only
```

---

## Infrastructure

### Docker Compose Setup

```yaml
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: devsloop_vault
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - '5432:5432'
```

### Environment Variables

```env
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/devsloop_vault

# Application
PORT=3001
NODE_ENV=development

# JWT
JWT_SECRET=your-jwt-secret
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=your-refresh-secret
JWT_REFRESH_EXPIRES_IN=7d

# Cache
CACHE_TTL=300

# Email (Nodemailer)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-email
SMTP_PASS=your-password
EMAIL_FROM=noreply@devsloop.com

# Frontend
FRONTEND_URL=http://localhost:3000
```

### Health Checks

| Endpoint                       | Purpose                      |
| ------------------------------ | ---------------------------- |
| `GET /api/v1/health`           | Full health check (database) |
| `GET /api/v1/health/liveness`  | Is app running?              |
| `GET /api/v1/health/readiness` | Is app ready to serve?       |

### GCP Cloud Build

Both backend and frontend have `cloudbuild.yaml` for automated deployments to Google Cloud Run.

---

## Frontend Architecture

### State Management

**Redux Toolkit** for global state:

- `authSlice` - User authentication state
- `serverStatusSlice` - Server health status

### API Layer

**Centralized API clients** with error handling:

```typescript
// lib/api/baseApi.ts - Base Axios instance with interceptors
// lib/api/authApi.ts - Authentication endpoints
// lib/api/adminApi.ts - Admin endpoints (users, projects, roles)
// lib/api/contributionApi.ts - Contribution endpoints
```

### Form Handling

**React Hook Form + Zod** for type-safe forms:

```typescript
const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const form = useForm({ resolver: zodResolver(schema) });
```

### Routing

**Next.js App Router** with route groups:

- `(auth)` - Authentication pages (login, register, etc.)
- `(dashboard)` - Protected dashboard pages

### Permission-Based UI

```typescript
// lib/utils/permissions.ts
const hasEntityAccess = (user, entityName) => {
  return user.entities.some(e => e.name === entityName);
};

// Usage in components
{hasEntityAccess(user, 'project') && <ProjectsLink />}
```

---

## Development Workflow

### Backend Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Start PostgreSQL
docker-compose up -d

# 3. Setup database
pnpm db:setup

# 4. Start development server
pnpm start:dev
```

### Frontend Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Start development server
pnpm dev
```

### Common Backend Commands

```bash
# Development
pnpm start:dev          # Start with watch mode
pnpm start:debug        # Start with debug mode

# Database
pnpm prisma:migrate     # Run migrations
pnpm prisma:generate    # Generate Prisma client
pnpm prisma:studio      # Open Prisma Studio
pnpm prisma:seed        # Seed database

# Code Quality
pnpm lint               # Lint and fix
pnpm format             # Format code
pnpm typecheck          # Type check
pnpm validate           # Lint + typecheck + test

# Testing
pnpm test               # Run tests
pnpm test:watch         # Watch mode
pnpm test:cov           # Coverage report
```

### Common Frontend Commands

```bash
# Development
pnpm dev                # Start development server

# Build
pnpm build              # Production build
pnpm start              # Start production server

# Code Quality
pnpm lint               # Lint code
pnpm lint:fix           # Lint and fix
pnpm format             # Format code
pnpm type-check         # Type check
```

---

## Summary

### Architecture Highlights

| Aspect       | Implementation                       |
| ------------ | ------------------------------------ |
| **Backend**  | NestJS 11 with modular architecture  |
| **Frontend** | Next.js 16 with App Router           |
| **Database** | PostgreSQL with Prisma ORM           |
| **Queue**    | pg-boss (PostgreSQL-based, no Redis) |
| **Cache**    | In-memory (no Redis)                 |
| **Auth**     | JWT with entity-based ACL            |
| **Events**   | In-memory event emitter              |
| **Logging**  | Pino structured logging              |

### Production Readiness

| Component             | Status     |
| --------------------- | ---------- |
| Authentication        | Complete   |
| Authorization (ACL)   | Complete   |
| User Management       | Complete   |
| Project Management    | Complete   |
| Contribution Workflow | Complete   |
| Review Workflow       | Complete   |
| Background Jobs       | Complete   |
| Health Monitoring     | Complete   |
| API Documentation     | Complete   |
| Cloud Deployment      | Configured |

---

**Document Version**: 2.0  
**Last Updated**: February 4, 2026  
**Maintained By**: Development Team
