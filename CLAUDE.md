# Backend — Claude Rules (NestJS 11 / Prisma 6)

## Stack
- **NestJS 11** — Dependency injection, modules, guards, decorators
- **Prisma 6.19** — ORM for PostgreSQL (never raw SQL unless parameterised FTS)
- **TypeScript** strict mode ON — no `any`, explicit types everywhere
- **JWT** (access + refresh tokens) — stateless auth
- **pg-boss** — PostgreSQL-backed job queue for async work
- **class-validator + class-transformer** — DTO validation
- **Pino** (via nestjs-pino) — structured JSON logging
- **pnpm** — package manager, Node ≥ 20

## Project Structure
```
backend/src/
├── app.module.ts           # Root module — imports all feature modules
├── main.ts                 # Bootstrap (helmet, CORS, global pipes, prefix)
├── auth/                   # Authentication (JWT, refresh, register, login)
├── users/                  # User management (CRUD, profile)
├── projects/               # Project management
├── contributions/          # Core feature (CRUD + FTS search)
│   └── services/           # contribution-search, content-processing, validation
├── reviews/                # Contribution review workflow
├── warnings/               # User warnings
├── roles/                  # Role definitions
├── rbac/                   # RBAC service (entity/permission management)
├── notifications/          # Email via Nodemailer + pg-boss queue
├── audit/                  # Audit log service
├── queue/                  # pg-boss service wrapper
├── health/                 # GET /health
├── vault/                  # Vault read endpoints
├── user-projects/          # User ↔ Project assignments
├── prisma/                 # PrismaService singleton
├── config/                 # Environment config validation
└── common/
    ├── guards/             # JwtAuthGuard, RolesGuard, EntityAccessGuard, etc.
    ├── decorators/         # @Public, @Roles, @RequireEntity, @CurrentUser, @AllowPending
    ├── filters/            # HttpExceptionFilter (global)
    ├── interceptors/       # LoggingInterceptor
    ├── pipes/              # CuidValidationPipe
    └── services/           # RequestContextModule
```

## Module Pattern — Follow This for Every Feature

```
src/<feature>/
├── <feature>.controller.ts   # HTTP routes + Swagger docs + guard decorators
├── <feature>.service.ts      # All business logic + Prisma calls
├── <feature>.module.ts       # Imports, providers, exports
├── dto/
│   ├── create-<feature>.dto.ts
│   ├── <feature>-response.dto.ts
│   └── index.ts              # Re-exports all DTOs
└── index.ts                  # Re-exports service/module
```

**Never** put business logic in controllers. Controllers only: parse params, call service, return result.

## DTO — Required Pattern

Every DTO field must have both `class-validator` decorators AND `@ApiProperty()`:

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength, IsEnum, IsOptional, IsInt, Min, Max } from 'class-validator';

export class CreateThingDto {
  @ApiProperty({ description: 'Name of the thing', example: 'My thing', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ description: 'Optional description', maxLength: 2000 })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ enum: SomeEnum, description: 'Category' })
  @IsEnum(SomeEnum)
  category: SomeEnum;
}
```

**Rules:**
- `@IsOptional()` only for genuinely optional fields — never to bypass validation.
- `@MaxLength()` on all user-provided strings to prevent oversized payloads.
- `@ApiProperty()` is required on every field for Swagger to work.
- Import enums from `@prisma/client` to stay in sync with schema.

## Controller — Required Decorators

```typescript
@ApiTags('Feature Name')
@ApiBearerAuth('JWT-auth')
@Controller('things')
export class ThingsController {
  constructor(private readonly thingsService: ThingsService) {}

  @Get()
  @RequireEntity('thing')                    // Entity-based access
  @ApiOperation({ summary: 'List things' })
  @ApiResponse({ status: 200, type: [ThingResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(@CurrentUser('id') userId: string): Promise<ThingResponseDto[]> {
    return this.thingsService.findAll(userId);
  }

  @Post()
  @RequireEntity('thing')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a thing' })
  @ApiResponse({ status: 201, type: ThingResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async create(
    @Body() dto: CreateThingDto,
    @CurrentUser('id') userId: string,
  ): Promise<ThingResponseDto> {
    return this.thingsService.create(dto, userId);
  }

  @Delete(':id')
  @RequireEntity('thing')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('id', CuidValidationPipe) id: string,
  ): Promise<void> {
    return this.thingsService.delete(id);
  }
}
```

## Guards & Decorators Reference

| Decorator | When to use |
|-----------|-------------|
| `@Public()` | Auth endpoints only: login, register, refresh, verify-email, forgot-password |
| `@AllowPending()` | Endpoints accessible before approval (e.g., GET /auth/me) |
| `@RequireEntity('name')` | **Preferred** — entity-based permission check |
| `@Roles('ADMIN')` | Role check — use sparingly, prefer entity |
| `@CurrentUser('id')` | Inject authenticated user's ID into param |
| `@CurrentUser()` | Inject full user object |
| `CuidValidationPipe` | Validate CUID format on `:id` route params |

## Prisma — Rules

```typescript
// Always select only needed fields
const user = await this.prisma.user.findUnique({
  where: { id },
  select: { id: true, name: true, email: true, approvalStatus: true },
});

// Always check existence before mutating
if (!user) throw new NotFoundException(`User ${id} not found`);

// Use transactions for multi-step writes
await this.prisma.$transaction(async (tx) => {
  await tx.thing.create({ data: { ... } });
  await tx.auditLog.create({ data: { ... } });
});

// Pagination pattern
const [items, total] = await Promise.all([
  this.prisma.thing.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
  this.prisma.thing.count({ where }),
]);
return { data: items, total, page, limit, totalPages: Math.ceil(total / limit), ... };
```

**Never:**
- Build raw SQL strings with user input (SQL injection).
- Write to `Contribution.searchVector` directly — it's maintained by DB trigger.
- Fetch full records when only a subset of fields is needed.

## Error Handling

```typescript
// Use NestJS HTTP exceptions — HttpExceptionFilter formats all responses
throw new NotFoundException(`Resource ${id} not found`);     // 404
throw new BadRequestException('Validation failed');           // 400
throw new ConflictException('Email already in use');          // 409
throw new ForbiddenException('You cannot access this');       // 403
throw new UnauthorizedException('Invalid credentials');       // 401

// Never do this
return res.status(500).json({ error: '...' });
```

## Logging

```typescript
private readonly logger = new Logger(MyService.name);

// Use appropriate level
this.logger.log(`Thing ${id} created by user ${userId}`);      // info
this.logger.warn(`Suspicious activity from user ${userId}`);   // warn
this.logger.error(`Failed to process: ${err.message}`, err.stack); // error

// Never log
this.logger.log(`Password: ${password}`);      // NEVER
this.logger.log(`Token: ${token}`);            // NEVER
this.logger.log(JSON.stringify(request.body)); // NEVER (may contain secrets)
```

## API Response Conventions

```typescript
// Single resource — return DTO directly (class-transformer serialises)
async getOne(id: string): Promise<ThingDto> { return dto; }

// Created — 201 + body
@HttpCode(HttpStatus.CREATED)
async create(dto: CreateDto): Promise<ThingDto> { return created; }

// Deleted — 204 no body
@HttpCode(HttpStatus.NO_CONTENT)
async delete(id: string): Promise<void> { await this.prisma.thing.delete(...); }

// Paginated list
return {
  data: items,
  total,
  page,
  limit,
  totalPages: Math.ceil(total / limit),
  hasNextPage: page < Math.ceil(total / limit),
  hasPreviousPage: page > 1,
};
```

## Caching Pattern

```typescript
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

// Read
const cached = await this.cacheManager.get<MyType>(`key:${id}`);
if (cached) return cached;

// Write (TTL in milliseconds, or use default from config)
await this.cacheManager.set(`key:${id}`, data, 300_000);

// Invalidate on mutation
await this.cacheManager.del(`key:${id}`);
```

Cache key convention: `<entity>:<id>` (e.g., `user:abc123`, `permissions:userId`).

## Queue / Async Jobs (pg-boss)

```typescript
// Enqueue a job (fire-and-forget)
await this.pgBossService.send('send-email', {
  to: user.email,
  type: 'warning-issued',
  payload: { userName: user.name, message: warning.message },
});

// Workers are registered in the service's onModuleInit
// Never await the job result inline — it defeats the purpose
```

Use jobs for: email sending, heavy computations, audit logging of complex events.

## Event Pattern (NestJS EventEmitter2)

```typescript
// Emit
this.eventEmitter.emit('contribution.approved', new ContributionApprovedEvent(contributionId, userId));

// Listen (in a separate listener class)
@OnEvent('contribution.approved')
async handleContributionApproved(event: ContributionApprovedEvent) {
  await this.pgBossService.send('send-email', { ... });
}
```

## Schema Changes Checklist

When modifying `prisma/schema.prisma`:
1. Add the field/model/enum.
2. Run: `npx prisma migrate dev --name <description>`
3. Run: `npx prisma generate` (updates TypeScript types)
4. Update all relevant DTOs to include the new field.
5. Update service mapping (`.map(x => ({ ..., newField: x.newField }))` ).
6. Update frontend types in `frontend/types/api.ts` or `frontend/types/models.ts`.

## Security Checklist for New Endpoints

- [ ] Protected by `JwtAuthGuard` (global) — no `@Public()` unless truly public
- [ ] Correct `@RequireEntity()` or `@Roles()` applied
- [ ] All route params validated with `CuidValidationPipe`
- [ ] Input DTO has `class-validator` on every field
- [ ] No raw SQL with user input
- [ ] No secrets logged
- [ ] Existence checks before mutations
- [ ] Appropriate HTTP codes on all responses

## Database Schema Reference

```
Models:       User, Project, Contribution, Bookmark, Role, Entity, RoleEntity,
              UserRoleAssignment, AclEntry, AuditLog, UserWarning, UserProject

Enums:        ApprovalStatus   (PENDING / APPROVED / REJECTED)
              WarningType      (INFO / MINOR / MAJOR / CRITICAL)
              ConfidentialityLevel (LOW / MEDIUM / HIGH)
              VisibilityLevel  (PRIVATE / INTERNAL / PUBLIC_ELIGIBLE)

All IDs:      CUID format — validate with CuidValidationPipe
FTS column:   Contribution.searchVector (tsvector) — DB trigger maintained, never write directly
```

## Common Mistakes to Avoid

- Do NOT put business logic in controllers — only in services.
- Do NOT skip `@ApiProperty()` on DTO fields — Swagger breaks.
- Do NOT use `@IsOptional()` as a workaround for required validation.
- Do NOT fetch full Prisma records when only a few fields are needed.
- Do NOT use `console.log` — use `this.logger`.
- Do NOT throw generic `Error` — use NestJS HTTP exceptions.
- Do NOT write to `searchVector` — it's DB trigger managed.
- Do NOT add raw SQL with string interpolation — always parameterised.
