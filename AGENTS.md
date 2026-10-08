# AGENTS.md — savy-core

Code rules, architecture, and context for the Savy REST API (NestJS + TypeScript + Prisma + Supabase).

This is the **authoritative reference** for any agent or human working on this project. Read it before touching anything.

---

## Project Overview

Savy is a personal finance PWA. This repo is the **REST API** that handles all business logic, data persistence, and authentication. The frontend (`savy-web`, separate repo) communicates exclusively with this API — it never touches Supabase directly.

### Live deployment
- **API**: https://savy-core.onrender.com
- **Swagger**: https://savy-core.onrender.com/api/docs
- **Platform**: Render (free tier, cold starts possible)

### Project Planning

All product decisions, entity design, behaviors, planned modules, and future ideas are documented in:

**[`savy-planning.md`](./savy-planning.md)** — read this before planning or building any new feature. This is the central reference for what the system does and how it should work.

### Key relationships
- Frontend repo: `savy-web` (https://github.com/Ianbleake/savy-web)
- Frontend talks to this API only. No Supabase client in the frontend.
- Frontend sends `POST /api/auth/login` with email/password → this API authenticates against Supabase GoTrue via admin client → returns JWT tokens to frontend → frontend stores tokens and sends `Authorization: Bearer <jwt>` on every request.
- This API validates the JWT using Supabase's JWKS endpoint (see Auth section below).

---

## Tech Stack

| Piece | Choice |
|---|---|
| Framework | NestJS 11 |
| Language | TypeScript 5.9 (strict) |
| Module system | **CommonJS** (NOT ESM — see Gotchas) |
| ORM | Prisma 7 with `@prisma/adapter-pg` |
| Database | PostgreSQL (Supabase hosted) |
| Auth | Supabase Auth (GoTrue) — admin client server-side |
| JWT validation | `passport-jwt` + `jwks-rsa` (ES256, see Auth section) |
| Validation | `class-validator` + `class-transformer` (DTOs) |
| Config | `@nestjs/config` with `.env` |
| Logger | Pino (`nestjs-pino`) with pino-pretty in dev |
| API docs | Swagger (`@nestjs/swagger`) at `/api/docs` |
| Linter/formatter | Biome (tabs, double quotes, 100 cols, semicolons) |
| Package manager | **bun** (never npm or yarn) |
| Testing | Jest (built-in NestJS) |

---

## Architecture

### Module structure

Each domain module lives in `src/{domain}/`:

```
src/{domain}/
├── {domain}.module.ts       — NestJS module definition
├── {domain}.controller.ts   — REST controller (with Swagger decorators)
├── {domain}.service.ts      — business logic
├── dto/                     — request/response DTOs
│   └── {domain}.dto.ts      — class-validator + @ApiProperty decorators
└── {domain}.d.ts            — ambient types (if needed, rare)
```

### Current modules

| Module | Path | Status | Description |
|---|---|---|---|
| PrismaModule | `src/prisma/` | ✓ Complete | Global, exports PrismaService |
| AuthModule | `src/auth/` | ✓ Complete | Supabase admin client + JWT strategy + guards |
| ProfilesModule | `src/profiles/` | ✓ Complete | Profile CRUD + computed fields (fullName, initials) |
| AccountsModule | `src/accounts/` | ✓ Complete | Account CRUD with soft delete |

### Modules to build (planned)

| Module | Description |
|---|---|
| TransactionsModule | Income/expense/transfer/payment movements |
| CategoriesModule | User-defined income/expense categories |
| BudgetsModule | Periodic budget tracking per category |
| SavingsGoalsModule | Savings targets with progress tracking |
| CreditCardsModule | Credit card logic: cut day, payment day, interest calc |
| CardStatementsModule | Statement generation: min payment, no-interest payment, interest amount |
| LoansModule | Loan tracking: principal, interest, monthly payment, remaining balance |

### Shared infrastructure

```
src/prisma/
├── prisma.module.ts          — @Global module
├── prisma.service.ts         — PrismaClient with pg adapter, OnModuleInit/OnModuleDestroy
src/auth/
├── supabase.service.ts       — Supabase admin client (service role key)
├── jwt.strategy.ts           — passport-jwt with jwks-rsa (ES256)
├── jwt-auth.guard.ts         — Global guard with @Public() bypass
├── public.decorator.ts       — @Public() marks routes as unauthenticated
├── current-user.decorator.ts — @CurrentUser() extracts Profile from request
src/profiles/
├── profiles.module.ts        — Exports ProfilesService
├── profiles.service.ts       — Profile CRUD + computed fullName/initials
├── profiles.controller.ts    — GET/PATCH /profiles/me
├── dto/profile.dto.ts        — UpdateProfileDto
src/app.module.ts             — Root module, global guard registration
src/main.ts                   — Bootstrap, CORS, ValidationPipe, Swagger
```

---

## Auth Architecture (CRITICAL — read before touching auth)

### The flow

```
Frontend ──(email/password)──> POST /api/auth/login
                                      │
                            AuthService.login()
                                      │
                            SupabaseService.signInWithPassword()
                                      │
                            Supabase GoTrue (admin client, service role key)
                                      │
                            Returns session { access_token, refresh_token }
                                      │
                            ProfilesService.findByAuthId(sub)
                                      │ (creates profile if first login)
                            Returns { accessToken, refreshToken, user: { id, email } }
                                      │
Frontend <──(tokens)── API <──────────┘
Frontend stores tokens in localStorage (Zustand persist, key: "auth-storage")
                                      │
Frontend ──(Bearer access_token)──> Any /api/* endpoint
                                      │
                            JwtAuthGuard (global, APP_GUARD)
                                      │
                            JwtStrategy validates token
                                      │
                            jwks-rsa fetches public key from
                            {SUPABASE_URL}/auth/v1/.well-known/jwks.json
                                      │
                            Verifies ES256 signature (ECDSA P-256)
                                      │
                            JwtStrategy.validate(payload)
                                      │
                            ProfilesService.findByAuthId(payload.sub)
                                      │
                            Attaches Profile to request.user
                                      │
                            Controller handler runs with @CurrentUser()
```

### CRITICAL: Supabase uses ES256, not HS256

Supabase signs JWTs with **ES256** (ECDSA with P-256 curve). The `SUPABASE_JWT_SECRET` in `.env` is the **key ID (kid)**, not an HMAC secret. Do NOT use `secretOrKey` with the JWT secret — it will silently fail with 401 on every authenticated request.

The `JwtStrategy` uses `jwks-rsa`'s `passportJwtSecret` to dynamically fetch and cache the public key from Supabase's JWKS endpoint. This is the only correct way to validate Supabase JWTs.

### Auth endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | @Public | Register new user via Supabase (accepts optional `firstName`, `lastName`) |
| POST | `/api/auth/login` | @Public | Login with email/password |
| POST | `/api/auth/refresh` | @Public | Refresh access token |
| POST | `/api/auth/forgot-password` | @Public | Send password reset email (never reveals if email exists) |
| POST | `/api/auth/reset-password` | @Public | Update password using tokens from reset email link |
| POST | `/api/auth/logout` | Bearer | Sign out (invalidates Supabase session) |
| GET | `/api/auth/me` | Bearer | Get current user identity (`{ id, email }` — minimal) |

### Profile endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/profiles/me` | Bearer | Get full profile with computed `fullName` and `initials` |
| PATCH | `/api/profiles/me` | Bearer | Update profile fields (firstName, lastName, secondLastName, avatarUrl, phone, currency, locale, timezone) |

### Auth decorators

- `@Public()` — marks a route as public (bypasses global JwtAuthGuard)
- `@CurrentUser()` — extracts the authenticated `Profile` from `request.user`
- `@ApiBearerAuth()` — Swagger decorator to show the "Authorize" button on an endpoint

### Supabase configuration

- **"Confirm email" is OFF** in Supabase dashboard (Authentication → Providers → Email). This allows immediate session creation on registration without email verification. Needed for development flow.
- The API uses the **service role key** (admin), not the anon key. This bypasses RLS.
- `autoRefreshToken: false` and `persistSession: false` in the Supabase client config — the API is stateless, the frontend handles token refresh.

---

## Database Architecture

### Prisma 7 configuration (CRITICAL — see Gotchas)

Prisma 7 has breaking changes from Prisma 6:

1. **No `url`/`directUrl` in `schema.prisma`** — they go in `prisma.config.ts`
2. **Client generated in `src/generated/prisma/`** (inside src, so `nest build` compiles it)
3. **Uses `@prisma/adapter-pg`** driver adapter (not the default Prisma engine)
4. **`prisma.config.ts`** handles env loading and migration adapter setup
5. **`postinstall` script** runs `prisma generate` automatically (needed for Render)

### Two connection strings

| Env var | Pooler | Port | Used for |
|---|---|---|---|
| `DATABASE_URL` | Transaction-mode (PgBouncer) | 6543 | Runtime (PrismaService) |
| `DIRECT_URL` | Session-mode | 5432 | Migrations (`prisma migrate dev`) |

Both point to the same Supabase Postgres instance. The transaction pooler is for the app runtime; the session pooler is for migrations (Prisma migrations don't work through PgBouncer).

### Schema conventions

- **Table names**: snake_case via `@@map("table_name")`
- **Column names**: camelCase in TS, snake_case in DB via `@map("column_name")`
- **IDs**: `String @id @default(uuid())` — UUIDs, not auto-increment
- **Money**: `Decimal @db.Decimal(12, 2)` — never use Float for money
- **Interest rates**: `Decimal @db.Decimal(5, 4)` — stored as decimal (0.3600 = 36%)
- **Soft delete**: `isActive Boolean` flag (used on Account, Budget)
- **Cascade**: `onDelete: Cascade` on user-owned resources, `onDelete: SetNull` on optional FKs
- **Timestamps**: `createdAt` with `@default(now())`, `updatedAt` with `@updatedAt`
- **Indexes**: `@@index` on commonly queried fields (e.g., `[accountId, date]`)

### Prisma client import

The generated client lives in `src/generated/prisma/`. Import types and classes from there:

```typescript
import { PrismaClient } from "../generated/prisma/client";
import type { Profile, Account } from "../generated/prisma/client";
```

The import path is **one level up** from domain modules (`../generated/prisma/client`), NOT two levels (`../../generated/prisma/client`). This was a bug we hit — don't repeat it.

### Data model (9 tables)

```
Profile ─┬─ Account ─┬─ Transaction ─ Category
         │           ├─ CreditCard ─ CardStatement
         │           └─ Loan
         ├─ Category
         ├─ Budget ─── Category
         └─ SavingsGoal
```

See `prisma/schema.prisma` for the full schema with all fields, enums, and relations.

### Running migrations

```bash
bunx prisma migrate dev --name <descriptive_name>
```

This uses `DIRECT_URL` (session pooler) via `prisma.config.ts`. Never run migrations with `DATABASE_URL` (transaction pooler) — it will fail.

After changing the schema:
1. Edit `prisma/schema.prisma`
2. Run `bunx prisma migrate dev --name <name>`
3. Run `bunx prisma generate` (usually automatic via postinstall)
4. Run `bun run build` to verify compilation

---

## Gotchas (learned the hard way)

### 1. CommonJS, not ESM

The project uses `"module": "commonjs"` in `tsconfig.json`. Prisma 7 generates client code that contains `import.meta.url` — when compiled with ESM settings, Node treats the output as ESM and crashes with `ReferenceError: exports is not defined in ES module scope`.

**Rules**:
- Never add `"type": "module"` to `package.json`
- Never use `"module": "nodenext"` in `tsconfig.json`
- Do NOT add `.js` extensions to relative imports (CommonJS doesn't need them and they can cause issues)
- Import from `@prisma/adapter-pg`, NOT `@prisma/adapter-pg/node` (the `/node` subpath was removed in v7.9)

### 2. nest build output path

With `"module": "commonjs"`, `nest build` puts output directly in `dist/` (not `dist/src/`). The `start:prod` script is `node dist/main.js`.

### 3. Render deployment

- **Build Command**: `bun install && bun run build` (postinstall runs `prisma generate` automatically)
- **Start Command**: `bun run start:prod` (NOT `bun run start` — that uses `nest start` which compiles in memory and OOMs on free tier)
- The Prisma client (`src/generated/prisma/`) is gitignored and must be generated during build
- All env vars must be set in Render dashboard: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL`, `DIRECT_URL`, `CORS_ORIGIN`

### 4. Supabase JWT validation

See the Auth Architecture section. The key point: Supabase uses ES256, the JWT secret in `.env` is a key ID, and validation must use `jwks-rsa` to fetch public keys from the JWKS endpoint.

### 5. Prisma 7 config separation

`prisma.config.ts` is excluded from `tsconfig.build.json` because it uses `defineConfig` from `prisma/config` which is not part of the NestJS build. Don't remove this exclusion.

---

## Conventions

### Code style

- **Biome** for linting and formatting (tabs, double quotes, 100 cols, semicolons)
- **Named exports only** — never `export default`
- **No `any`** — investigate the type first, use Prisma-generated types
- `import type` for type-only imports
- No `.js` extensions on relative imports (CommonJS)
- Use `!` (definite assignment assertion) on DTO properties with decorators: `email!: string`

### Controllers

- Every controller gets `@ApiTags("domain")` for Swagger grouping
- Every authenticated endpoint gets `@ApiBearerAuth()` at the controller level
- Every endpoint gets `@ApiOperation({ summary: "..." })` and `@ApiResponse` decorators
- Use `@CurrentUser()` to get the authenticated user — never read from headers directly
- Use `@Param("id")` with string type — UUIDs are strings

### DTOs

- Every DTO field gets `@ApiProperty()` with `example` and `description`
- Use class-validator decorators: `@IsEmail()`, `@IsString()`, `@IsNotEmpty()`, `@IsEnum()`, `@IsNumber()`, `@IsOptional()`, `@MinLength()`
- DTOs go in `src/{domain}/dto/{domain}.dto.ts`
- For create/update, use separate DTOs: `CreateXxxDto`, `UpdateXxxDto`

### Services

- Inject `PrismaService` via constructor
- All queries scope by `profileId` from `@CurrentUser()` — never trust client input for ownership
- Soft delete with `isActive: false` instead of hard delete (for Account, Budget)
- Throw `NotFoundException` when a resource doesn't exist or doesn't belong to the user
- Return Prisma entities directly (the `ValidationPipe` with `transform` handles serialization)

### General

- All endpoints under `/api` prefix (set in `main.ts`)
- CORS enabled for `CORS_ORIGIN` env var (default: `http://localhost:3000`)
- `ValidationPipe` is global with `whitelist`, `forbidNonWhitelisted`, `transform`
- Pino logger with pino-pretty in dev, raw JSON in production
- Swagger at `/api/docs`, spec JSON at `/api/docs-json`

### Naming

| Type | Pattern | Example |
|---|---|---|
| Module | `{domain}.module.ts` | `accounts.module.ts` |
| Controller | `{domain}.controller.ts` | `accounts.controller.ts` |
| Service | `{domain}.service.ts` | `accounts.service.ts` |
| DTO | `{domain}.dto.ts` | `account.dto.ts` |
| Guard | `{name}.guard.ts` | `jwt-auth.guard.ts` |
| Decorator | `{name}.decorator.ts` | `public.decorator.ts` |
| Strategy | `{name}.strategy.ts` | `jwt.strategy.ts` |

### File paths

- Source code: `src/`
- Prisma schema: `prisma/schema.prisma`
- Prisma config: `prisma.config.ts`
- Migrations: `prisma/migrations/`
- Generated client: `src/generated/prisma/` (gitignored, generated by `postinstall`)
- Build output: `dist/`

---

## Commands

```bash
# Development
bun run start:dev          # Start with watch mode (hot reload)

# Build & production
bun run build              # Compile with nest build → dist/
bun run start:prod         # Run compiled JS (node dist/main.js)

# Database
bunx prisma migrate dev --name <name>   # Create + apply migration
bunx prisma generate                    # Regenerate client (usually auto via postinstall)
bunx prisma studio                      # Open Prisma Studio (DB GUI)

# Code quality
bun run check              # Biome check + write
bun run lint               # Biome lint + write
bun run format             # Biome format + write

# Testing
bun run test               # Jest unit tests
bun run test:e2e           # Jest e2e tests

# Swagger
# Available at /api/docs when the server is running
```

---

## Environment Variables

| Variable | Description | Example |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (admin, NEVER expose to frontend) | `sb_secret_...` |
| `SUPABASE_JWT_SECRET` | JWT key ID (kid) — used as reference, not for HMAC | `8cf644dc-...` |
| `DATABASE_URL` | Transaction pooler (runtime) | `postgresql://...:6543/postgres?pgbouncer=true` |
| `DIRECT_URL` | Session pooler (migrations) | `postgresql://...:5432/postgres` |
| `PORT` | Server port | `3001` |
| `CORS_ORIGIN` | Allowed origins for CORS (comma-separated) | `http://localhost:3000,https://savy-web.bleakedev.workers.dev` |
| `CREDIT_CARD_REACTIVE_ENABLED` | Feature flag for credit card reactive behavior. Only the exact string `true` enables it. Gates writes (statement generation, over-limit validation, InstallmentPlan creation, PAYMENT waterfall). Reads (`availableCredit`, `paymentDueDate`) are never gated. Default `false` | `true` |
| `CREDIT_CARD_MAX_CATCH_UP_PERIODS` | Max missed statement periods generated in one lazy catch-up. Falls back to `12` when unset or invalid | `12` |

All variables are in `.env` (gitignored). Use `.env.example` as a template.

**Never commit `.env` or any file containing real credentials.**

---

## Response Style

- **Brief, technical, direct.** No verbose explanations or redundant context.
- Go straight to the point: what was done, why, and code if applicable.
- Don't repeat context the user already knows.
- Prioritize token efficiency in every response.