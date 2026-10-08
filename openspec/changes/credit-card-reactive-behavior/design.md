# Design: Credit Card Reactive Behavior

## Technical Approach

The change converts Savy's credit cards from CRUD-only containers into reactive entities that calculate interest, generate statements on cut dates, track installment plans, and enforce spending limits — matching real Mexican credit card behavior per Banxico/CONDUSEF rules.

The strategy is **calculation-engine-first**: a pure, Prisma-free `CreditCalculationService` owns every formula (average daily balance, interest + IVA, minimum payment, PNGI, payment due date, business-day adjustment, MSCI amortization). An orchestrator (`StatementGenerationService`) consumes that engine, queries transactions by date range, and persists frozen `CardStatement` rows inside a single Prisma transaction. Lazy triggers in `DashboardService` and `CardStatementsController` call `generatePending(profileId)` before reads. No cron, no background jobs — matches the lazy strategy in `savy-planning.md` Priority 4.

All reactive behavior is gated behind `CREDIT_CARD_REACTIVE_ENABLED` (env, default `false`). With the flag off, the API behaves exactly as today: CRUD-only, caller-supplied statement fields, no over-limit check, no installment plans.

Decimal arithmetic uses `Prisma.Decimal` (re-exported from `@prisma/client`). No new npm dependency — the proposal explicitly forbids it. Float is prohibited for all money and rate calculations.

Specs referenced:
- `specs/statement-generation` — lazy trigger, multi-period catch-up, frozen semantics, idempotency, statement-transaction link, payment waterfall
- `specs/interest-calculation` — avg daily balance, Banxico formula, IVA 16%, conditional trigger, PNGI, saldo a favor
- `specs/minimum-payment-calc` — Banxico Circular 13/2011 formula, balance cap
- `specs/payment-due-date` — cut + offset, next business day, migration from `paymentDay`
- `specs/installment-plans` — MSI/MSCI entity, lifecycle, MSCI simplified amortization
- `specs/over-limit-validation` — EXPENSE on CREDIT rejection, tolerance, saldo a favor
- `specs/available-credit` — computed field, DTO layer only
- `specs/commissions` — typed EXPENSE transactions, IVA-inclusive amount

## Architecture Decisions

### Decision: CreditCalculationService placement and structure

**Choice**: `src/credit-cards/calculations/credit-calculation.service.ts` — an `@Injectable()` NestJS service with **zero Prisma dependency**. It lives inside the `CreditCardsModule` (not a shared module) because every function is credit-card-domain-specific. The subfolder `calculations/` groups the service and its pure helper files.

```
src/credit-cards/calculations/
├── credit-calculation.service.ts    — @Injectable, exports all public methods
├── business-days.util.ts            — pure functions: isWeekend, isHoliday, getNextBusinessDay
├── mexican-holidays.ts              — hardcoded holiday list + movable-holiday computation
└── credit-calculation.service.spec.ts — pure unit tests, no NestJS module needed
```

**Alternatives considered**:
1. *Shared `src/common/calculations/`* — rejected. The functions are credit-card-specific (avg daily balance, PNGI, Banxico minimum payment). Putting them in `common` implies reusability that doesn't exist.
2. *Static functions, not a service* — rejected. NestJS DI lets `StatementGenerationService` and `TransactionsService` inject it cleanly, and lets tests mock it. Static functions would require manual wiring and break the established `@Injectable()` pattern.
3. *Separate module `CalculationsModule`* — rejected. Over-engineering. The service has no external dependencies to provide; it's a pure utility service. Registering it as a provider in `CreditCardsModule` and exporting it is sufficient.

**Rationale**: Keeps the calculation engine co-located with the domain it serves, testable in isolation (the spec file imports the service directly without `Test.createTestingModule`), and injectable across modules via `CreditCardsModule.exports`. The `calculations/` subfolder signals "pure logic, no I/O" without leaving the domain boundary.

### Decision: Decimal library — Prisma.Decimal, no new dependency

**Choice**: Use `Prisma.Decimal` (re-exported from `../generated/prisma/client`) for all money and rate arithmetic. The proposal explicitly states "No new npm dependencies."

```typescript
import { Prisma } from "../generated/prisma/client";
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
```

`Prisma.Decimal` is a `decimal.js` instance under the hood (Prisma 7 re-exports it). It supports `.add()`, `.sub()`, `.mul()`, `.div()`, `.toDecimalPlaces(2)`, `.cmp()`, `.gte()`, `.lte()` — everything needed.

**Alternatives considered**:
1. *Add `decimal.js` directly* — rejected. Violates the proposal's "no new dependencies" constraint and duplicates what Prisma already provides.
2. *Use `number` with integer cents* — rejected. The existing `money.util.ts` has `toCents`, but the specs require Decimal arithmetic explicitly ("Float is prohibited"). Mixing cents and Decimal would create conversion noise at every boundary.

**Rationale**: One decimal type across the codebase. Prisma already returns `Decimal` for `Decimal(12,2)` columns, so calculations stay in the same type without `Number()` conversions (which are the current source of float imprecision in `DashboardService` and `TransactionsService`).

### Decision: StatementGenerationService as orchestrator with transactional boundary

**Choice**: `src/card-statements/statement-generation.service.ts` — an `@Injectable()` service in `CardStatementsModule`. It injects `PrismaService` and `CreditCalculationService`. The entire multi-period generation for one card runs inside a **single `prisma.$transaction(async (tx) => ...)`**.

**Alternatives considered**:
1. *One transaction per period* — rejected. If period 2 of 3 fails, period 1 is committed but period 3 is lost, leaving the card in an inconsistent state. Partial catch-up with no rollback path.
2. *No transaction (auto-commit each write)* — rejected. Statement creation + transaction `statementId` assignment + installment plan `currentMonth` increment must be atomic per card. Without a transaction, a crash mid-generation leaves transactions unlinked or plans un-advanced.
3. *Generation inside `CardStatementsService`* — rejected. `CardStatementsService` is CRUD; mixing orchestration (multi-period detection, transaction linking, calculation delegation) into it violates single responsibility and makes the CRUD service untestable in isolation.

**Rationale**: A single transaction per card ensures all-or-nothing generation. If the process crashes, the next read retries from the last committed statement. The orchestrator is separate from CRUD so `CardStatementsService.findAll` / `findOne` stay simple and the generation logic is independently testable.

### Decision: Idempotency via unique constraint + last-statement check

**Choice**: Two-layer idempotency:
1. **Schema**: `@@unique([creditCardId, periodStart])` on `CardStatement` — database-level guarantee against duplicate periods.
2. **Application**: `StatementGenerationService` queries the latest statement by `periodEnd desc` before generating. If the latest `periodEnd` >= the candidate period's `periodStart`, that period is skipped.

**Alternatives considered**:
1. *Only application check (no DB constraint)* — rejected. Concurrent reads (two dashboard calls) could both pass the check and both insert. The spec scenario "Concurrent reads do not duplicate" requires a DB guarantee.
2. *Only DB constraint (catch unique violation)* — rejected. Relying solely on catching `P2002` means the losing concurrent request throws an error instead of receiving the statement. The application check avoids the error path for the common case; the DB constraint is the safety net.

**Rationale**: The application check handles the normal case cleanly (second read finds the statement, skips generation). The unique constraint handles the race condition (two reads pass the check simultaneously; one insert wins, the other gets `P2002` and is caught + retried as a read). This matches the spec's "at most one `CardStatement` is created" scenario.

### Decision: Lazy trigger points — dashboard + card-statements controller, not credit-cards controller

**Choice**: `generatePending(profileId)` is called at exactly two points:
1. `DashboardService.getSummary` — before the `Promise.all` that fetches credit cards.
2. `CardStatementsController.findAll` — before delegating to `CardStatementsService.findAllByProfile`.

`CreditCardsController.findAll` and `CreditCardsController.findOne` do **NOT** trigger generation. They return the card with computed `availableCredit` (which reads `account.balance`, always current) but do not generate statements.

**Alternatives considered**:
1. *Also trigger on `CreditCardsController.findOne`* — rejected. `availableCredit` is real-time from `account.balance`; it doesn't need a statement. Triggering here adds a multi-period generation cost to every card detail view, which the frontend calls frequently.
2. *Trigger on every authenticated request via middleware* — rejected. Generation is card-specific and only relevant when viewing card data. Middleware would run it for unrelated endpoints (profiles, budgets).

**Rationale**: The dashboard is the primary "open the app" entry point — it's where the lazy strategy should fire. The card-statements list is the explicit "show me statements" view. Credit-cards endpoints are about card metadata, not statement state. Keeping the trigger minimal reduces unnecessary DB writes.

### Decision: Migration strategy — paymentDay nullable + paymentDueDays additive

**Choice**: The migration is **additive**:
1. Add `paymentDueDays Int? @default(20) @map("payment_due_days")` to `CreditCard`.
2. Change `paymentDay Int` to `paymentDay Int?` (make nullable, keep existing values).
3. Backfill: `UPDATE credit_cards SET payment_due_days = 20 WHERE payment_due_days IS NULL`.
4. `paymentDay` remains in the schema as deprecated; DTOs stop accepting it for new cards but still return it for backward compatibility.

**Alternatives considered**:
1. *Drop `paymentDay` immediately* — rejected. Breaking change on live DB. Existing rows have `paymentDay = 10` (or similar); dropping loses that data and breaks any frontend reading it.
2. *Rename `paymentDay` to `paymentDueDays` in-place* — rejected. Prisma can't rename columns in-place; it requires a drop + add. Same breaking issue.

**Rationale**: Additive migration with backfill is the safest path. The spec scenario "Existing card migrated to default offset" requires `paymentDueDays = 20` for existing rows. Keeping `paymentDay` nullable preserves data and lets the frontend transition gradually. A follow-up change can drop `paymentDay` after the frontend stops reading it.

### Decision: Transaction changes — over-limit check + InstallmentPlan creation + PAYMENT waterfall

**Choice**: `TransactionsService.create` gains a CREDIT-specific path inside the existing `prisma.$transaction`:

```typescript
// Inside create(), after validateAccountOwnership, before tx.transaction.create:
if (dto.type === "EXPENSE" && account.type === "CREDIT") {
    await this.validateOverLimit(tx, dto.accountId, dto.amount);
}
```

When `dto.msiMonths` is provided (and feature flag is on), an `InstallmentPlan` is created inside the same transaction:

```typescript
if (dto.msiMonths && dto.msiType) {
    await this.createInstallmentPlan(tx, transaction.id, dto);
}
```

For `PAYMENT` on CREDIT accounts, after `applyBalance`, a new `applyPaymentToStatement` method updates the latest unpaid statement's `paidAmount`, `remainingBalance`, `isPaid`, `updatedAt` using the waterfall function.

**Alternatives considered**:
1. *Over-limit check outside the transaction* — rejected. The balance could change between the check and the `applyBalance` call (concurrent EXPENSE). The check must be inside the transaction, reading the current `account.balance` via `tx.account.findFirst`.
2. *InstallmentPlan creation in a separate service* — rejected. It must be atomic with the transaction creation. If the transaction is created but the plan fails, the card balance is consumed with no plan tracking. Same transaction is the only safe boundary.
3. *PAYMENT waterfall as a separate service* — considered. Could be `PaymentApplicationService`. Rejected for v1 — the waterfall logic is a single pure function (`CreditCalculationService.applyPaymentWaterfall`) and the statement update is a simple `tx.cardStatement.update`. A separate service adds wiring without value until the waterfall becomes more complex.

**Rationale**: The existing `prisma.$transaction` pattern in `TransactionsService.create` is the natural boundary. All new CREDIT-path logic (over-limit, installment plan, payment waterfall) is additive inside that transaction. No new service for payment application — the calculation is pure and the persistence is a single update.

### Decision: Payment waterfall — explicit assumption, isolated function

**Choice**: The payment waterfall is implemented as a single pure function in `CreditCalculationService`:

```typescript
interface WaterfallInput {
    paymentAmount: Decimal;
    interestAmount: Decimal;
    commissionTotal: Decimal;
    ordinaryBalance: Decimal;
    msiMensualidadTotal: Decimal;
    msciMensualidadTotal: Decimal;
}

interface WaterfallResult {
    interestApplied: Decimal;
    commissionsApplied: Decimal;
    ordinaryApplied: Decimal;
    msiApplied: Decimal;
    msciApplied: Decimal;
    remainder: Decimal;  // leftover if payment exceeds all categories
}

applyPaymentWaterfall(input: WaterfallInput): WaterfallResult
```

Order: **interest → commissions → ordinary balance → MSI mensualidad → MSCI mensualidad**.

The function and its spec file carry a prominent `// ASSUMPTION — TODO: Verify against primary Banxico/CONDUSEF source.` comment.

**Alternatives considered**:
1. *Reject the assumption, block the change* — rejected. The research gap is documented and the proposal explicitly allows the assumption with user acceptance. Blocking would stall the entire change for an unfindable primary source.
2. *Make the order configurable* — rejected for v1. Configuration implies we know the correct order and are letting users override it. We don't know the correct order — we're assuming. Hardcode the assumption with a TODO; if verified later, the function is the single point of change.

**Rationale**: The research (Engram observation #644) confirms the gap: "exact payment waterfall not explicitly stated in primary sources." The proposal and both specs (statement-generation, commissions) document this as an assumption. Isolating it in one pure function means: (a) unit-testable in isolation, (b) single point of change when verified, (c) the TODO is visible to any future developer touching the file. This is the **explicit acceptance** the spec requires.

### Decision: MSCI amortization — simplified simple-interest formula with TODO

**Choice**: `monthlyAmount = (principal / totalMonths) + (principal × interestRate / totalMonths)`. This is simple interest divided evenly across months — no compounding, no declining-balance amortization.

```typescript
calculateMsciMonthlyAmount(principal: Decimal, rate: Decimal, totalMonths: number): Decimal {
    // ASSUMPTION — TODO: Verify exact MSCI amortization method against primary sources.
    // Simplified: simple interest divided by months. Real banks likely use declining-balance
    // amortization (interest accrues on remaining principal, not original).
    const monthlyPrincipal = principal.div(totalMonths);
    const monthlyInterest = principal.mul(rate).div(totalMonths);
    return monthlyPrincipal.add(monthlyInterest);
}
```

**Alternatives considered**:
1. *Declining-balance amortization (French method)* — rejected for v1. More accurate but requires an amortization table (array of `{ principal, interest, balance }` per month). The spec explicitly accepts the simplified method with a TODO. Implementing the French method now would be gold-plating an unverified assumption.
2. *Store a full amortization schedule* — rejected. The `InstallmentPlan` entity tracks `currentMonth` and `monthlyAmount`, not a per-month schedule. A schedule would require a new `InstallmentSchedule` table. Out of scope.

**Rationale**: The spec (installment-plans, "MSCI Amortization (Simplified v1)") and the research both flag this as a known gap. The simplified formula is deterministic, testable with known values (principal 6000, rate 0.12, 12 months → 560.00), and the TODO marker is the trigger for a future precision change. Matching the spec's accepted assumption.

### Decision: Mexican holidays — hardcoded constant with movable-holiday computation

**Choice**: `src/credit-cards/calculations/mexican-holidays.ts` exports a pure function `getMexicanHolidays(year: number): Date[]` that returns all Mexican national holidays for a given year. Fixed-date holidays are hardcoded constants; movable holidays (observed on first Monday) are computed.

Fixed holidays:
- January 1 (Año Nuevo)
- February 5 (Día de la Constitución) — observed on first Monday of February per 2006 reform
- March 21 (Natalicio de Benito Juárez) — observed on third Monday of March per 2006 reform
- May 1 (Día del Trabajo)
- September 16 (Día de la Independencia) — observed on third Monday of September per 2006 reform
- November 20 (Día de la Revolución) — observed on third Monday of November per 2006 reform
- December 25 (Navidad)

The function computes the observed dates for movable holidays. Holidays that fall on Saturday are not moved (banks don't observe them on Friday). Sunday holidays move to Monday — but for our purposes, Saturday/Sunday are already non-business days, so the adjustment is implicit.

```typescript
export function getMexicanHolidays(year: number): Date[] {
    return [
        new Date(year, 0, 1),                                    // Jan 1
        getFirstMondayOfMonth(year, 1),                          // Feb: Constitución
        getThirdMondayOfMonth(year, 2),                          // Mar: Benito Juárez
        new Date(year, 4, 1),                                    // May 1
        getThirdMondayOfMonth(year, 8),                          // Sep: Independencia
        getThirdMondayOfMonth(year, 10),                         // Nov: Revolución
        new Date(year, 11, 25),                                  // Dec 25
    ];
}
```

**Alternatives considered**:
1. *Database table `mexican_holidays`* — rejected for v1. Requires a migration, a seed script, and annual maintenance of the table. The spec says "hardcoded or configurable list for v1" and "MUST NOT depend on an external holiday API." A constant is simpler and the holiday set changes rarely.
2. *External holiday API (e.g., date.nager.at)* — explicitly rejected by the spec ("MUST NOT depend on an external holiday API").
3. *Config file (JSON/YAML)* — considered. More flexible than a constant but adds a config-loading path. The holiday list is stable enough that a TS constant is sufficient. A future change can externalize it if needed.

**Rationale**: Mexican national holidays are a small, stable set (7 holidays). Hardcoding them in a pure TS function with computed movable-holiday logic is the simplest correct solution. The function is deterministic and unit-testable for any year. The spec's "Holiday list is configurable" scenario is satisfied by the function being a single swap point — replace the function body to change the holiday set.

### Decision: Feature flag — CREDIT_CARD_REACTIVE_ENABLED gates all reactive behavior

**Choice**: A single env var `CREDIT_CARD_REACTIVE_ENABLED` (default: `"false"`) gates every reactive behavior:

| Behavior | Gated? | How |
|---|---|---|
| Statement generation trigger | Yes | `generatePending` returns early if flag is false |
| Over-limit validation | Yes | `validateOverLimit` skipped if flag is false |
| InstallmentPlan creation | Yes | `createInstallmentPlan` skipped if flag is false |
| PAYMENT waterfall to statement | Yes | `applyPaymentToStatement` skipped if flag is false |
| `availableCredit` computed field | **No** | Always computed (pure read, no side effects) |
| `paymentDueDate` on response | **No** | Always returned if present on statement |
| `CardStatement.create` (manual) | **No** | Existing CRUD still works (for admin/legacy) |

**Alternatives considered**:
1. *Multiple flags per feature* — rejected. Adds configuration complexity. The change ships as one unit; granular flags imply partial rollout which the proposal doesn't require.
2. *No flag (ship everything on)* — rejected. The proposal's rollback plan requires the flag. Breaking changes (paymentDay → paymentDueDays, dashboard contract) need a safe rollout path.

**Rationale**: One flag, clear semantics. With it off, the API is identical to today. With it on, all reactive behavior activates. `availableCredit` and `paymentDueDate` are read-only computed fields with no side effects — gating them adds complexity without safety. The flag gates **writes** (generation, validation, plan creation, waterfall), not **reads**.

### Decision: Module organization — extend existing modules, no new modules

**Choice**: No new NestJS modules. All new services are providers in existing modules:

```
CreditCardsModule
  providers: [CreditCardsService, CreditCalculationService]  ← add
  exports: [CreditCardsService, CreditCalculationService]     ← add (so CardStatementsModule can import)

CardStatementsModule
  imports: [CreditCardsModule]                                 ← add (to get CreditCalculationService)
  providers: [CardStatementsService, StatementGenerationService] ← add

TransactionsModule
  imports: [CreditCardsModule]                                 ← add (to get CreditCalculationService)
  providers: [TransactionsService]                             ← unchanged, injects CreditCalculationService

DashboardModule
  imports: [CardStatementsModule]                              ← add (to get StatementGenerationService)
  providers: [DashboardService]                                ← unchanged, injects StatementGenerationService
```

**Alternatives considered**:
1. *New `CreditCalculationsModule`* — rejected. `CreditCalculationService` has no dependencies (no Prisma, no config). It's a pure utility service. A dedicated module for one provider is over-engineering.
2. *New `InstallmentPlansModule`* — rejected. Installment plans are created inside `TransactionsService.create` (same transaction) and read inside `StatementGenerationService`. There's no `InstallmentPlansController` — plans are not independently CRUD'd. A module without a controller and with no service of its own is unnecessary.

**Rationale**: The existing module structure is `src/{domain}/` with `{domain}.module.ts`. Adding providers to existing modules and importing `CreditCardsModule` where the calculation service is needed follows the established pattern. The dependency graph is acyclic: `CreditCardsModule` (no deps) → `CardStatementsModule` (deps: CreditCards) → `DashboardModule` (deps: CardStatements). `TransactionsModule` imports `CreditCardsModule` directly.

## Data Flow

### Module dependency diagram

```
    PrismaModule (global)
         │
         ▼
    CreditCardsModule
    ├── CreditCardsService (CRUD + computed availableCredit)
    ├── CreditCalculationService (pure: interest, minPayment, PNGI, dueDate, waterfall, MSCI)
    │   ├── calculations/business-days.util.ts (pure)
    │   └── calculations/mexican-holidays.ts (pure)
    └── exports: CreditCalculationService
         │
         ├──────────────────┐
         ▼                  ▼
    CardStatementsModule   TransactionsModule
    ├── CardStatementsService (CRUD)    ├── TransactionsService (CRUD + over-limit + InstallmentPlan + waterfall)
    └── StatementGenerationService      └── injects CreditCalculationService
        └── injects CreditCalculationService
         │
         ▼
    DashboardModule
    └── DashboardService (injects StatementGenerationService → generatePending before read)
```

### Statement generation flow (sequence)

```
DashboardController.getSummary
  │
  ▼
DashboardService.getSummary
  │
  ├─► StatementGenerationService.generatePending(profileId)
  │     │
  │     ├─► [feature flag check] if !enabled → return
  │     │
  │     ├─► prisma.creditCard.findMany({ where: { account: { profileId } } })
  │     │     → cards[]
  │     │
  │     └─► for each card:
  │           └─► prisma.$transaction(async (tx) => {
  │                 ├─► tx.cardStatement.findFirst({ orderBy: { periodEnd: "desc" }, take: 1 })
  │                 │     → lastStatement (or null)
  │                 │
  │                 ├─► computeMissedPeriods(lastStatement, card.cutDay, now, maxCatchUp=12)
  │                 │     → periods[] (each: { periodStart, periodEnd })
  │                 │
  │                 └─► for each period:
  │                       ├─► [idempotency check] tx.cardStatement.findUnique({ creditCardId, periodStart })
  │                       │     → if exists, skip
  │                       │
  │                       ├─► tx.transaction.findMany({ where: { accountId: card.accountId, date: { gte: periodStart, lte: periodEnd }, statementId: null } })
  │                       │     → periodTransactions[]
  │                       │
  │                       ├─► tx.transaction.updateMany({ where: { id: { in: txIds } }, data: { statementId: statement.id } })
  │                       │     → link transactions to statement
  │                       │
  │                       ├─► CreditCalculationService.calculateAverageDailyBalance(...)
  │                       ├─► CreditCalculationService.calculateInterest(...) [conditional on prev period payment < PNGI]
  │                       ├─► CreditCalculationService.calculatePngi(...)
  │                       ├─► CreditCalculationService.calculateMinimumPayment(...)
  │                       ├─► CreditCalculationService.calculatePaymentDueDate(periodEnd, card.paymentDueDays)
  │                       │
  │                       ├─► tx.installmentPlan.findMany({ where: { transaction: { accountId: card.accountId }, status: "ACTIVE" } })
  │                       │     → activePlans[]
  │                       │
  │                       ├─► [for each active plan] tx.installmentPlan.update({ currentMonth: { increment: 1 } })
  │                       │     [if currentMonth + 1 >= totalMonths] → status: "COMPLETED"
  │                       │
  │                       └─► tx.cardStatement.create({ ...frozen fields, isGenerated: true })
  │              })
  │
  ├─► [rest of getSummary: fetch accounts, transactions, cards, loans, etc.]
  │
  └─► return DashboardSummary
```

### Payment application flow (sequence)

```
TransactionsController.create (type: PAYMENT, destinationAccountId: credit-card-account)
  │
  ▼
TransactionsService.create
  │
  └─► prisma.$transaction(async (tx) => {
        ├─► validateAccountOwnership (source account)
        ├─► validateAccountOwnership (destination = CREDIT account)
        ├─► validateDestinationType (PAYMENT → CREDIT or LOAN)
        │
        ├─► tx.transaction.create({ ... })
        ├─► applyBalance(tx, PAYMENT, sourceAccount, destAccount, amount, +1)
        │     → dest CREDIT account balance decremented (debt reduced)
        │
        ├─► [feature flag check] if enabled && destAccount.type === "CREDIT":
        │     └─► applyPaymentToStatement(tx, destAccountId, amount)
        │           ├─► tx.cardStatement.findFirst({
        │           │     where: { creditCard: { accountId: destAccountId }, isPaid: false },
        │           │     orderBy: { periodEnd: "desc" },
        │           │     take: 1
        │           │   }) → latestUnpaidStatement
        │           │
        │           ├─► [if no unpaid statement] → return (payment creates saldo a favor)
        │           │
        │           ├─► tx.transaction.findMany({
        │           │     where: { statementId: latestUnpaidStatement.id, type: "EXPENSE" }
        │           │   }) → periodTransactions[]
        │           │
        │           ├─► CreditCalculationService.applyPaymentWaterfall({
        │           │     paymentAmount: amount,
        │           │     interestAmount: latestUnpaidStatement.interestAmount,
        │           │     commissionTotal: sum of commission transactions,
        │           │     ordinaryBalance: ...,
        │           │     msiMensualidadTotal: ...,
        │           │     msciMensualidadTotal: ...
        │           │   }) → waterfallResult
        │           │
        │           └─► tx.cardStatement.update({
        │                 where: { id: latestUnpaidStatement.id },
        │                 data: {
        │                   paidAmount: { increment: amount },
        │                   remainingBalance: latestUnpaidStatement.balance - (paidAmount + amount),
        │                   isPaid: (paidAmount + amount) >= balance,
        │                   updatedAt: new Date()
        │                 }
        │               })
        │
        └─► return transaction
      })
```

### InstallmentPlan state machine

```
                    [transaction created with msiMonths]
                              │
                              ▼
                         ┌─────────┐
                         │ ACTIVE  │ currentMonth = 0
                         └─────────┘
                              │
              [statement generation: currentMonth++]
                              │
                    ┌─────────┴──────────┐
                    │                    │
           currentMonth < totalMonths   currentMonth >= totalMonths
                    │                    │
                    ▼                    ▼
              ┌─────────┐          ┌───────────┐
              │ ACTIVE  │          │ COMPLETED │
              └─────────┘          └───────────┘
                    │                    │
              [repeat on each            [no further mensualidad
               statement generation]     in statements; plan balance
                    │                     excluded from PNGI]
                    │                    │
                    │              [terminal state]
                    │
              [user-initiated cancellation — future capability]
                    │
                    ▼
              ┌───────────┐
              │ CANCELLED │ remaining balance → revolving debt
              └───────────┘
                    │
              [terminal state — no further mensualidad]
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `prisma/schema.prisma` | Modify | `CreditCard`: add `paymentDueDays Int? @default(20)`, make `paymentDay` nullable, add `overLimitTolerance Decimal? @default(0)`. `CardStatement`: add `paymentDueDate DateTime?`, `updatedAt DateTime? @updatedAt`, `paidAmount Decimal @default(0)`, `remainingBalance Decimal?`, `isGenerated Boolean @default(false)`, `@@unique([creditCardId, periodStart])`. `Transaction`: add `statementId String?` (FK to `CardStatement`, `onDelete: SetNull`), `commissionType CommissionType?`. New `InstallmentPlan` model. New enums: `CommissionType`, `InstallmentPlanType`, `InstallmentPlanStatus`. |
| `prisma/migrations/<timestamp>_credit_card_reactive_behavior/` | Create | Additive migration: all new columns nullable/defaulted, new tables, new enums. Backfill `payment_due_days = 20` for existing rows. |
| `src/credit-cards/calculations/credit-calculation.service.ts` | Create | Pure `@Injectable()` service. Methods: `calculateAverageDailyBalance`, `calculateInterest` (with IVA), `calculateMinimumPayment`, `calculatePngi`, `calculatePaymentDueDate`, `getNextBusinessDay`, `applyPaymentWaterfall`, `calculateMsciMonthlyAmount`. No Prisma import. |
| `src/credit-cards/calculations/business-days.util.ts` | Create | Pure functions: `isWeekend(date)`, `isHoliday(date, holidays)`, `getNextBusinessDay(date, holidays)`. |
| `src/credit-cards/calculations/mexican-holidays.ts` | Create | `getMexicanHolidays(year): Date[]` — fixed + movable holidays. Pure, no I/O. |
| `src/credit-cards/calculations/credit-calculation.service.spec.ts` | Create | Pure unit tests for every calculation method. No NestJS module — import service directly. Covers all spec scenarios with known values. |
| `src/credit-cards/credit-cards.module.ts` | Modify | Add `CreditCalculationService` to providers and exports. |
| `src/credit-cards/credit-cards.service.ts` | Modify | `findAll` and `findOne` map responses to include `availableCredit`, `currentBalance`, `nextPaymentDueDate`. `create` accepts `paymentDueDays` (not `paymentDay`). Add `toResponseDto` private method. |
| `src/credit-cards/dto/credit-card.dto.ts` | Modify | `CreateCreditCardDto`: replace `paymentDay` with `paymentDueDays`, add optional `overLimitTolerance`. `UpdateCreditCardDto`: same. `CreditCardResponseDto`: add `availableCredit`, `currentBalance`, `nextPaymentDueDate`, `paymentDueDays`. Keep `paymentDay` as deprecated optional for backward compat. |
| `src/card-statements/statement-generation.service.ts` | Create | `@Injectable()` orchestrator. Method: `generatePending(profileId): Promise<void>`. Injects `PrismaService`, `CreditCalculationService`, `ConfigService`. Multi-period catch-up, idempotency, transactional boundary, transaction linking, installment plan advancement. |
| `src/card-statements/statement-generation.service.spec.ts` | Create | Unit tests with mocked PrismaService and CreditCalculationService. Covers: no-op when flag off, single period, multi-period catch-up, idempotency, cut day 31 in February, no transactions in period. |
| `src/card-statements/card-statements.module.ts` | Modify | Add `StatementGenerationService` to providers and exports. Import `CreditCardsModule`. |
| `src/card-statements/card-statements.service.ts` | Modify | `findAll` — no change to query logic. `create` — when feature flag is on, reject caller-supplied `balance`/`minPayment`/`noInterestPayment`/`interestAmount` (generation-only). When flag off, keep existing behavior. |
| `src/card-statements/card-statements.controller.ts` | Modify | `findAll` calls `StatementGenerationService.generatePending(profileId)` before delegating to service. |
| `src/card-statements/dto/card-statement.dto.ts` | Modify | `CreateCardStatementDto`: mark calculated fields as deprecated/forbidden when flag on. `CardStatementResponseDto`: add `paymentDueDate`, `paidAmount`, `remainingBalance`, `isGenerated`, `updatedAt`. `UpdateCardStatementDto`: restrict to mutable fields only (`paidAmount`, `isPaid`); frozen fields rejected. |
| `src/transactions/transactions.module.ts` | Modify | Import `CreditCardsModule` (for `CreditCalculationService`). |
| `src/transactions/transactions.service.ts` | Modify | `create`: add `validateOverLimit` (CREDIT EXPENSE path), `createInstallmentPlan` (when `msiMonths`), `applyPaymentToStatement` (PAYMENT on CREDIT). All gated by feature flag. All inside existing `prisma.$transaction`. |
| `src/transactions/dto/transaction.dto.ts` | Modify | `CreateTransactionDto`: add `msiMonths?: number`, `msiType?: InstallmentPlanType`, `commissionType?: CommissionType`. `TransactionResponseDto`: add `statementId?: string`, `commissionType?: CommissionType`. |
| `src/dashboard/dashboard.module.ts` | Modify | Import `CardStatementsModule` (for `StatementGenerationService`). |
| `src/dashboard/dashboard.service.ts` | Modify | `getSummary`: call `statementGenerationService.generatePending(profile.id)` before `Promise.all`. `computeCreditOverview`: use `paymentDueDate` (not `periodEnd`) for `nextPaymentDue`, expose `noInterestPayment` and `interestAmount` from latest statement. |
| `src/dashboard/dto/dashboard.dto.ts` | Modify | `CreditCardSummary`: add `noInterestPayment`, `interestAmount`, `paymentDueDate`. |
| `src/banks/banks.service.ts` | Modify | `findCreditCardsByBank`: add `availableCredit` to mapped response. |
| `src/banks/dto/bank-sub-resources.dto.ts` | Modify | `BankCreditCardResponseDto`: add `availableCredit`, `paymentDueDays`. |
| `src/app.module.ts` | Modify | No change needed — existing module registrations cover new providers (they're inside existing modules). |
| `.env.example` | Modify | Add `CREDIT_CARD_REACTIVE_ENABLED=false` and `CREDIT_CARD_MAX_CATCH_UP_PERIODS=12`. |

## Interfaces / Contracts

### CreditCalculationService

```typescript
import { Prisma } from "../../generated/prisma/client";

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

interface DailyBalancePoint {
	date: Date;
	balance: Decimal; // account.balance at end of this day
}

interface InterestInput {
	averageDailyBalance: Decimal;
	annualRate: Decimal; // 0.3600 = 36%
	periodDays: number;
}

interface InterestResult {
	preIva: Decimal;
	iva: Decimal;
	total: Decimal; // preIva + iva (stored as interestAmount)
}

interface MinimumPaymentInput {
	revolvingBalance: Decimal; // balance - planBalances + mensualidades
	periodInterest: Decimal; // IVA-inclusive
	creditLimit: Decimal;
	statementBalance: Decimal;
}

interface PngiInput {
	totalSaldoDeudor: Decimal;
	installmentPlans: Array<{
		type: "MSI" | "MSCI";
		remainingBalance: Decimal;
		currentMensualidad: Decimal;
		status: "ACTIVE" | "COMPLETED" | "CANCELLED";
	}>;
}

interface WaterfallInput {
	paymentAmount: Decimal;
	interestAmount: Decimal;
	commissionTotal: Decimal;
	ordinaryBalance: Decimal;
	msiMensualidadTotal: Decimal;
	msciMensualidadTotal: Decimal;
}

interface WaterfallResult {
	interestApplied: Decimal;
	commissionsApplied: Decimal;
	ordinaryApplied: Decimal;
	msiApplied: Decimal;
	msciApplied: Decimal;
	remainder: Decimal;
}

@Injectable()
export class CreditCalculationService {
	calculateAverageDailyBalance(
		periodStart: Date,
		periodEnd: Date,
		transactions: Array<{ date: Date; type: string; amount: Decimal; destinationAccountId?: string | null }>,
		startingBalance: Decimal,
	): Decimal;

	calculateInterest(input: InterestInput): InterestResult;

	calculateMinimumPayment(input: MinimumPaymentInput): Decimal;

	calculatePngi(input: PngiInput): Decimal;

	calculatePaymentDueDate(cutDate: Date, paymentDueDays: number): Date;

	getNextBusinessDay(date: Date, holidays: Date[]): Date;

	applyPaymentWaterfall(input: WaterfallInput): WaterfallResult;

	calculateMsciMonthlyAmount(principal: Decimal, rate: Decimal, totalMonths: number): Decimal;
}
```

### StatementGenerationService

```typescript
@Injectable()
export class StatementGenerationService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly calculationService: CreditCalculationService,
		private readonly configService: ConfigService,
	) {}

	/**
	 * Detects and generates all missing CardStatement rows for every credit card
	 * owned by the profile. No-op when CREDIT_CARD_REACTIVE_ENABLED is false.
	 * No-op when no cut dates have passed since the last generated statement.
	 */
	async generatePending(profileId: string): Promise<void>;
}
```

### InstallmentPlan model (Prisma)

```prisma
enum InstallmentPlanType {
	MSI
	MSCI
}

enum InstallmentPlanStatus {
	ACTIVE
	COMPLETED
	CANCELLED
}

enum CommissionType {
	ANNUAL_FEE
	LATE_PAYMENT
	CASH_ADVANCE
}

model InstallmentPlan {
	id             String                @id @default(uuid())
	transactionId  String                @map("transaction_id")
	type           InstallmentPlanType
	totalMonths    Int                   @map("total_months")
	currentMonth   Int                   @default(0) @map("current_month")
	monthlyAmount  Decimal               @map("monthly_amount") @db.Decimal(12, 2)
	interestRate   Decimal?              @map("interest_rate") @db.Decimal(5, 4) // null for MSI, non-null for MSCI
	status         InstallmentPlanStatus @default(ACTIVE)
	createdAt      DateTime              @default(now()) @map("created_at")
	updatedAt      DateTime              @updatedAt @map("updated_at")

	transaction Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)

	@@index([transactionId])
	@@map("installment_plans")
}
```

### Modified CardStatement (Prisma additions)

```prisma
model CardStatement {
	// ... existing fields ...
	paymentDueDate   DateTime?  @map("payment_due_date")
	paidAmount       Decimal    @default(0) @map("paid_amount") @db.Decimal(12, 2)
	remainingBalance Decimal?   @map("remaining_balance") @db.Decimal(12, 2)
	isGenerated      Boolean    @default(false) @map("is_generated")
	updatedAt        DateTime?  @updatedAt @map("updated_at")

	transactions Transaction[]

	@@unique([creditCardId, periodStart])
	@@index([creditCardId, periodEnd])
	@@map("card_statements")
}
```

### Modified Transaction (Prisma additions)

```prisma
model Transaction {
	// ... existing fields ...
	statementId    String?         @map("statement_id")
	commissionType CommissionType? @map("commission_type")

	statement    CardStatement?    @relation(fields: [statementId], references: [id], onDelete: SetNull)
	installmentPlan InstallmentPlan?

	@@index([accountId, date])
	@@index([statementId])
	@@map("transactions")
}
```

### Modified CreditCard (Prisma additions)

```prisma
model CreditCard {
	// ... existing fields ...
	paymentDueDays      Int?     @default(20) @map("payment_due_days")
	overLimitTolerance  Decimal  @default(0) @map("over_limit_tolerance") @db.Decimal(12, 2)
	// paymentDay becomes nullable (deprecated)
	paymentDay          Int?     @map("payment_day")
	// ... existing relations ...
}
```

### Payment waterfall isolation

The waterfall is the **only** function that knows the application order. All callers pass the raw category totals and receive the applied amounts. If the order is verified wrong in the future, only `applyPaymentWaterfall` changes.

```typescript
// ASSUMPTION — TODO: Verify against primary Banxico/CONDUSEF source.
// Order: interest → commissions → ordinary → MSI → MSCI
// This is an assumption based on common banking practice, not a confirmed
// primary-source rule. See proposal "Payment waterfall" risk and
// specs/statement-generation "Payment Waterfall Application" requirement.
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit — `CreditCalculationService` | Average daily balance (single purchase, multiple, payment mid-period, saldo a favor) | Pure function calls with known inputs/outputs. No NestJS module. Import service directly. All values as `Prisma.Decimal`. |
| Unit — `CreditCalculationService` | Interest formula + IVA (standard, zero balance, IVA on zero) | Same as above. Verify `total = preIva × 1.16`. |
| Unit — `CreditCalculationService` | Minimum payment (formula (a) wins, (b) wins, balance cap, zero balance) | Same. Verify `min(formulaResult, balance)` cap. |
| Unit — `CreditCalculationService` | PNGI (no plans, MSI exclusion + mensualidad, multiple plans) | Same. Verify `pngi = saldoDeudor - planBalances + mensualidades`. |
| Unit — `CreditCalculationService` | Payment due date (20-day offset, Saturday, Sunday, holiday, holiday+weekend) | Same. Use `getMexicanHolidays(year)` to build holiday list. |
| Unit — `CreditCalculationService` | Payment waterfall (partial interest, full coverage with remainder, empty categories) | Same. Verify order and remainder carry-forward. |
| Unit — `CreditCalculationService` | MSCI monthly amount (known formula: 6000 × 0.12 / 12 = 60 interest, 500 + 560 total) | Same. |
| Unit — `mexican-holidays.ts` | Fixed holidays for 2026, movable holidays (Constitución first Monday Feb, Juárez third Monday Mar, Independencia third Monday Sep, Revolución third Monday Nov) | Pure function calls. Verify exact dates for known years. |
| Unit — `StatementGenerationService` | No-op when flag off, single period generation, multi-period catch-up (3 periods), idempotency (existing period skipped), cut day 31 in February, no transactions in period | Mock `PrismaService` with `tx` mock. Mock `CreditCalculationService`. Verify `cardStatement.create` called N times with correct frozen fields. Verify `transaction.updateMany` called for transaction linking. |
| Unit — `TransactionsService` | Over-limit rejection (balance + amount > limit), at-limit accepted, tolerance applied, saldo a favor spending, DEBIT bypass, PAYMENT bypass | Mock `PrismaService`. Existing spec pattern (`Test.createTestingModule` with useValue mock). |
| Unit — `TransactionsService` | InstallmentPlan creation (MSI 12 months → monthlyAmount 500, MSCI → calculated amount), no plan when msiMonths absent | Mock `PrismaService`. Verify `installmentPlan.create` called with correct fields. |
| Unit — `TransactionsService` | PAYMENT waterfall to statement (paidAmount increment, isPaid flip, remainingBalance update, no unpaid statement → saldo a favor) | Mock `PrismaService` and `CreditCalculationService.applyPaymentWaterfall`. |
| Unit — `CreditCardsService` | `availableCredit` computed correctly (positive, zero, negative, saldo a favor) | Mock `PrismaService`. Verify response DTO mapping. |
| Unit — `DashboardService` | `computeCreditOverview` uses `paymentDueDate` not `periodEnd`, exposes `noInterestPayment` and `interestAmount` | Mock `PrismaService` and `StatementGenerationService`. |
| Integration | Full statement generation lifecycle: transactions → statement → interest → minPayment → paymentDueDate | `@nestjs/testing` module with real `CreditCalculationService` (not mocked) and mocked Prisma. Verify end-to-end calculation chain. |
| Integration | Installment plan lifecycle: purchase → 3 statements → currentMonth advances → completion | Same. Verify `currentMonth` increments and `COMPLETED` transition. |
| E2E | `GET /api/dashboard/summary` triggers generation after cut date | `supertest` with test DB. Seed card + transactions. Verify statement appears in response. |
| E2E | `POST /api/transactions` with EXPENSE on CREDIT over limit → 400 | `supertest`. Verify error message. |
| E2E | `POST /api/transactions` with `msiMonths=12` → InstallmentPlan created | `supertest` + verify DB state. |
| E2E | Feature flag off → no generation, no over-limit rejection | `supertest` with `CREDIT_CARD_REACTIVE_ENABLED=false`. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. This change adds domain logic (calculations, DB writes, validation) within the existing NestJS HTTP request/response cycle. No new external process integration.

## Migration / Rollout

### Schema migration

1. **Edit `prisma/schema.prisma`** — add all new fields (nullable/defaulted), new `InstallmentPlan` model, new enums.
2. **Run migration**: `bunx prisma migrate dev --name credit_card_reactive_behavior` (uses `DIRECT_URL` session pooler via `prisma.config.ts`).
3. **Backfill**: the migration SQL includes `UPDATE credit_cards SET payment_due_days = 20 WHERE payment_due_days IS NULL`.
4. **Regenerate client**: `bunx prisma generate` (automatic via `postinstall`).
5. **Build check**: `bun run build` — verify no TypeScript errors under strict mode.

### Feature flag rollout

1. **Phase 0**: Deploy with `CREDIT_CARD_REACTIVE_ENABLED=false`. All new fields exist in DB but no reactive behavior runs. API is identical to today.
2. **Phase 1**: Enable flag in dev/staging. Verify statement generation, interest calculation, over-limit rejection against known test cases.
3. **Phase 2**: Enable flag in production. Monitor for: unexpected statement generation, interest calculation mismatches vs real bank statements, performance impact on dashboard.
4. **Rollback**: Set `CREDIT_CARD_REACTIVE_ENABLED=false`. All reactive behavior stops. Generated statements remain in DB (identifiable by `isGenerated = true`); a cleanup script can delete them if needed.

### Frontend coordination

- `paymentDueDate` is additive to dashboard and card-statements responses. Frontend can ignore it until ready.
- `periodEnd` is retained on `CardStatement` (not removed). Dashboard `nextPaymentDue` switches from `periodEnd` to `paymentDueDate` — this is a value change, not a field change. Frontend reading `nextPaymentDue` automatically gets the correct date.
- `paymentDay` is retained on `CreditCard` response (deprecated). Frontend should migrate to `paymentDueDays` but won't break if it doesn't.

No hard frontend blocker. Coordination recommended but not required for rollout.

## Open Questions

- [ ] **Payment waterfall order**: The research gap is explicitly accepted as an assumption (interest → commissions → ordinary → MSI → MSCI). The user has accepted this per the proposal. If a primary Banxico/CONDUSEF source is found later, `applyPaymentWaterfall` is the single function to update. **Status: accepted assumption, not a blocker.**
- [ ] **MSCI amortization precision**: The simplified simple-interest formula is accepted for v1 with a TODO. Real banks likely use declining-balance amortization. Future change should implement the French method and store a per-month schedule. **Status: accepted assumption, not a blocker.**
- [ ] **Catch-up period limit**: Default `CREDIT_CARD_MAX_CATCH_UP_PERIODS=12`. If a user has been inactive for >12 months, older periods are skipped with a warning log. Is 12 the right default? Should it be configurable per-card? **Status: configurable via env, 12 is a reasonable default.**
- [ ] **Statement generation when card has no transactions in the period**: The spec requires a statement to still be generated (with balance from prior period, potentially zero new charges). The design generates the statement with the prior balance carried forward and any active installment plan mensualidades. Is this the correct behavior, or should empty periods be skipped? **Status: generate the statement — the spec says "frozen snapshot" per period, not per activity. A period with no transactions still has a balance (prior period's remaining) and due date.**
- [ ] **`overLimitTolerance` per-card vs global**: The design adds `overLimitTolerance` to `CreditCard` (per-card). The spec says "MAY be configured per card or globally." Per-card is more flexible and a global default can be added later. **Status: per-card with `@default(0)`, no global env var for v1.**
- [ ] **Concurrent generation across cards for the same profile**: The design uses one `prisma.$transaction` per card. Two cards for the same profile generate in separate transactions — no conflict. But `generatePending` is called from dashboard and card-statements simultaneously. Should we add a per-profile lock to avoid double generation? **Status: the unique constraint `[creditCardId, periodStart]` is the safety net. The application check (latest statement) handles the common case. A per-profile lock is over-engineering for v1.**