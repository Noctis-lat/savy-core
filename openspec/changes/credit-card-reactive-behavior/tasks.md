# Tasks: Credit Card Reactive Behavior

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 2500–3500 (6 phases, ~30 files, 8 specs, ~25 new test files) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (schema) → PR 2 (calc engine + tests) → PR 3 (statement generation + tests) → PR 4 (transaction changes + tests) → PR 5 (dashboard/DTOs + tests) → PR 6 (feature flag wiring + integration) |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Schema migration (additive, all nullable/defaulted) | PR 1 | `bunx prisma migrate dev --name credit_card_reactive_behavior && bun run build` | `bunx prisma studio` (manual schema inspection) | Drop migration + revert schema.prisma — no code depends on new fields yet |
| 2 | CreditCalculationService pure engine + business-days + holidays + unit tests | PR 2 | `bun run test src/credit-cards/calculations/credit-calculation.service.spec.ts` | N/A — pure functions, no runtime harness needed | Delete `src/credit-cards/calculations/` — no callers yet |
| 3 | StatementGenerationService orchestrator + lazy trigger + idempotency + unit tests | PR 3 | `bun run test src/card-statements/statement-generation.service.spec.ts` | Manual: start dev server, call GET /api/dashboard/summary with CREDIT_CARD_REACTIVE_ENABLED=true after a cut date | Delete `statement-generation.service.ts` + revert controller trigger — CRUD still works |
| 4 | Transaction changes: over-limit validation + InstallmentPlan creation + PAYMENT waterfall + unit tests | PR 4 | `bun run test src/transactions/transactions.service.spec.ts` | Manual: POST /api/transactions with EXPENSE on CREDIT over limit → expect 400 | Revert transaction service additions + DTO changes — existing CRUD transactions still work |
| 5 | Dashboard + DTOs: availableCredit computed field + paymentDueDate + response DTOs + unit tests | PR 5 | `bun run test src/credit-cards/credit-cards.service.spec.ts src/dashboard/dashboard.service.spec.ts src/banks/banks.service.spec.ts` | Manual: GET /api/credit-cards → verify availableCredit in response | Revert DTO + service mapping additions — responses lose computed fields but still return stored data |
| 6 | Feature flag wiring + .env.example + CardStatementsController trigger + integration tests | PR 6 | `bun run test` (full suite) | Manual: toggle CREDIT_CARD_REACTIVE_ENABLED false → verify CRUD-only behavior; true → verify generation triggers | Set flag to false — all reactive behavior disabled, API identical to pre-change |

## Phase 1: Schema Migration (Foundation)

- [x] T-001 Add new enums to `prisma/schema.prisma`: `InstallmentPlanType` (MSI, MSCI), `InstallmentPlanStatus` (ACTIVE, COMPLETED, CANCELLED), `CommissionType` (ANNUAL_FEE, LATE_PAYMENT, CASH_ADVANCE)
  - **Files**: `prisma/schema.prisma`
  - **Dependencies**: None
  - **Verification**: `bunx prisma validate` — schema parses without error
  - **TDD**: No test (structural type definition — triangulation skipped: enum definitions have one possible output)

- [x] T-002 Add `InstallmentPlan` model to `prisma/schema.prisma` with fields: `id`, `transactionId` (FK to Transaction, onDelete: Cascade), `type` (InstallmentPlanType), `totalMonths`, `currentMonth` (default 0), `monthlyAmount` (Decimal 12,2), `interestRate` (Decimal 5,4, nullable), `status` (default ACTIVE), `createdAt`, `updatedAt`. Add `@@index([transactionId])` and `@@map("installment_plans")`. Add `installmentPlan InstallmentPlan?` relation to `Transaction`.
  - **Files**: `prisma/schema.prisma`
  - **Dependencies**: T-001
  - **Verification**: `bunx prisma validate`
  - **TDD**: No test (structural schema definition)

- [x] T-003 Modify `CreditCard` in `prisma/schema.prisma`: add `paymentDueDays Int? @default(20) @map("payment_due_days")`, add `overLimitTolerance Decimal @default(0) @map("over_limit_tolerance") @db.Decimal(12, 2)`, change `paymentDay Int` to `paymentDay Int? @map("payment_day")` (make nullable for deprecation)
  - **Files**: `prisma/schema.prisma`
  - **Dependencies**: T-001
  - **Verification**: `bunx prisma validate`
  - **TDD**: No test (structural schema change)

- [x] T-004 Modify `CardStatement` in `prisma/schema.prisma`: add `paymentDueDate DateTime? @map("payment_due_date")`, `paidAmount Decimal @default(0) @map("paid_amount") @db.Decimal(12, 2)`, `remainingBalance Decimal? @map("remaining_balance") @db.Decimal(12, 2)`, `isGenerated Boolean @default(false) @map("is_generated")`, `updatedAt DateTime? @updatedAt @map("updated_at")`. Add `transactions Transaction[]` relation. Add `@@unique([creditCardId, periodStart])`. Keep existing `@@index([creditCardId, periodEnd])`.
  - **Files**: `prisma/schema.prisma`
  - **Dependencies**: T-001
  - **Verification**: `bunx prisma validate`
  - **TDD**: No test (structural schema change)

- [x] T-005 Modify `Transaction` in `prisma/schema.prisma`: add `statementId String? @map("statement_id")`, `commissionType CommissionType? @map("commission_type")`. Add `statement CardStatement? @relation(fields: [statementId], references: [id], onDelete: SetNull)`. Add `@@index([statementId])`.
  - **Files**: `prisma/schema.prisma`
  - **Dependencies**: T-001, T-002, T-004
  - **Verification**: `bunx prisma validate`
  - **TDD**: No test (structural schema change)

- [x] T-006 Create and apply migration: `bunx prisma migrate dev --name credit_card_reactive_behavior` (uses DIRECT_URL session pooler via prisma.config.ts). Verify migration SQL includes backfill: `UPDATE credit_cards SET payment_due_days = 20 WHERE payment_due_days IS NULL`. Run `bunx prisma generate` to regenerate client.
  - **Files**: `prisma/migrations/<timestamp>_credit_card_reactive_behavior/migration.sql`
  - **Dependencies**: T-001 through T-005
  - **Verification**: `bun run build` — TypeScript compiles with new generated client types. Manual: inspect migration SQL for additive-only changes + backfill statement.
  - **TDD**: No test (migration execution — verified by build + schema inspection)

## Phase 2: Calculation Engine (Core Pure Logic)

- [x] T-007 RED: Write failing unit tests for `mexican-holidays.ts` — `getMexicanHolidays(year)` function. Test fixed holidays for 2026 (Jan 1, May 1, Dec 25). Test movable holidays: Constitución first Monday of Feb 2026 (Feb 2), Benito Juárez third Monday of Mar 2026 (Mar 16), Independencia third Monday of Sep 2026 (Sep 21), Revolución third Monday of Nov 2026 (Nov 16). Triangulate with 2027 dates.
  - **Files**: `src/credit-cards/calculations/mexican-holidays.spec.ts` (create), `src/credit-cards/calculations/mexican-holidays.ts` (create — empty stub so import resolves but returns wrong values)
  - **Dependencies**: T-006 (generated client available for build)
  - **Verification**: `bun run test src/credit-cards/calculations/mexican-holidays.spec.ts` — tests FAIL (RED)
  - **TDD**: RED step — tests written first, reference `getMexicanHolidays` which returns empty array (stub)

- [x] T-008 GREEN + TRIANGULATE: Implement `mexican-holidays.ts` — `getMexicanHolidays(year: number): Date[]` returning all 7 Mexican national holidays with movable-holiday computation (`getFirstMondayOfMonth`, `getThirdMondayOfMonth` helper functions). Run tests → pass. Add 2027 triangulation cases → pass.
  - **Files**: `src/credit-cards/calculations/mexican-holidays.ts`
  - **Dependencies**: T-007
  - **Verification**: `bun run test src/credit-cards/calculations/mexican-holidays.spec.ts` — ALL pass (GREEN)
  - **TDD**: GREEN + TRIANGULATE — real logic replacing stub

- [x] T-009 RED: Write failing unit tests for `business-days.util.ts` — `isWeekend(date)`, `isHoliday(date, holidays)`, `getNextBusinessDay(date, holidays)`. Test scenarios: Saturday → true, Wednesday → false; date in holiday list → true; Wednesday not in list → false. `getNextBusinessDay`: Saturday Nov 7 2026 → Monday Nov 9; Sunday Nov 8 → Monday Nov 9; Sep 16 2026 (holiday) → Sep 17; holiday+weekend (Sep 16 2026 is Wednesday — use a Friday holiday scenario); Wednesday Nov 4 → Nov 4 (no adjustment). Triangulate with year boundary dates.
  - **Files**: `src/credit-cards/calculations/business-days.util.spec.ts` (create), `src/credit-cards/calculations/business-days.util.ts` (create — stub)
  - **Dependencies**: T-008 (mexican-holidays available for test setup)
  - **Verification**: `bun run test src/credit-cards/calculations/business-days.util.spec.ts` — FAIL (RED)
  - **TDD**: RED step

- [x] T-010 GREEN + TRIANGULATE: Implement `business-days.util.ts` with `isWeekend`, `isHoliday`, `getNextBusinessDay`. Use Date arithmetic (no external libs). Run tests → pass.
  - **Files**: `src/credit-cards/calculations/business-days.util.ts`
  - **Dependencies**: T-009
  - **Verification**: `bun run test src/credit-cards/calculations/business-days.util.spec.ts` — ALL pass
  - **TDD**: GREEN + TRIANGULATE

- [x] T-011 RED: Write failing unit tests for `CreditCalculationService.calculateAverageDailyBalance`. Test spec scenarios: single purchase mid-period (0×14 + 3000×15)/30 = 1500.00; multiple purchases (0×4 + 1000×15 + 3000×11)/30 = 1600.00; payment reduces balance (5000×9 + 3000×21)/30 = 3600.00; saldo a favor treated as 0 for interest (0×14 + 1000×15)/30 = 500.00; full period saldo a favor → 0.00. Use `Prisma.Decimal` for all values. Import service directly (no NestJS module).
  - **Files**: `src/credit-cards/calculations/credit-calculation.service.spec.ts` (create), `src/credit-cards/calculations/credit-calculation.service.ts` (create — stub with empty method returning `new Decimal(0)`)
  - **Dependencies**: T-006
  - **Verification**: `bun run test src/credit-cards/calculations/credit-calculation.service.spec.ts` — FAIL (RED)
  - **TDD**: RED step — 5 spec scenarios as test cases

- [x] T-012 GREEN + TRIANGULATE: Implement `calculateAverageDailyBalance` in `CreditCalculationService`. Sort transactions by date, walk day-by-day from periodStart to periodEnd, track running balance, clamp negative balances to 0 for interest calc. Sum daily balances, divide by periodDays. Return `Decimal`. Run tests → pass.
  - **Files**: `src/credit-cards/calculations/credit-calculation.service.ts`
  - **Dependencies**: T-011
  - **Verification**: `bun run test src/credit-cards/calculations/credit-calculation.service.spec.ts` — ALL pass
  - **TDD**: GREEN + TRIANGULATE — 5 scenarios force real logic

- [x] T-013 RED: Write failing unit tests for `CreditCalculationService.calculateInterest` (with IVA). Test: standard (1500 × 0.001 × 30 = 45.00 pre-IVA, 52.20 total); zero balance → 0.00; IVA on zero → 0.00. Verify `InterestResult` shape: `{ preIva, iva, total }` where `total = preIva × 1.16`.
  - **Files**: `src/credit-cards/calculations/credit-calculation.service.spec.ts` (append tests)
  - **Dependencies**: T-012
  - **Verification**: `bun run test src/credit-cards/calculations/credit-calculation.service.spec.ts` — new tests FAIL
  - **TDD**: RED step

- [x] T-014 GREEN: Implement `calculateInterest(input: InterestInput): InterestResult`. Formula: `preIva = avgDailyBalance × (annualRate / 360) × periodDays`, `iva = preIva × 0.16`, `total = preIva + iva`. Run tests → pass.
  - **Files**: `src/credit-cards/calculations/credit-calculation.service.ts`
  - **Dependencies**: T-013
  - **Verification**: `bun run test src/credit-cards/calculations/credit-calculation.service.spec.ts` — ALL pass
  - **TDD**: GREEN

- [x] T-015 RED: Write failing unit tests for `CreditCalculationService.calculatePngi`. Test: no plans → pngi = saldoDeudor (5000.00); MSI exclusion (8000 - 6000 + 500 = 2500.00); multiple plans (10000 - 3000 - 4000 + 500 + 700 = 4200.00). Test with COMPLETED/CANCELLED plans excluded.
  - **Files**: `src/credit-cards/calculations/credit-calculation.service.spec.ts` (append)
  - **Dependencies**: T-014
  - **Verification**: `bun run test src/credit-cards/calculations/credit-calculation.service.spec.ts` — new tests FAIL
  - **TDD**: RED step

- [x] T-016 GREEN: Implement `calculatePngi(input: PngiInput): Decimal`. Filter plans to ACTIVE only. `pngi = totalSaldoDeudor - sum(activePlan.remainingBalance) + sum(activePlan.currentMensualidad)`. Run tests → pass.
  - **Files**: `src/credit-cards/calculations/credit-calculation.service.ts`
  - **Dependencies**: T-015
  - **Verification**: `bun run test src/credit-cards/calculations/credit-calculation.service.spec.ts` — ALL pass
  - **TDD**: GREEN

- [x] T-017 RED: Write failing unit tests for `CreditCalculationService.calculateMinimumPayment`. Test: formula (a) wins (127.20 > 125.00); formula (b) wins (15.00 < 250.00 → 250.00); balance cap (625.00 capped to 500.00); zero balance → 0.00; zero balance with high credit limit → 0.00; no intermediate rounding (3333.33 × 1.5% + 0 = 49.9999... → rounded to 50.00). revolvingBalance excludes plan balances + includes mensualidades.
  - **Files**: `src/credit-cards/calculations/credit-calculation.service.spec.ts` (append)
  - **Dependencies**: T-016
  - **Verification**: `bun run test src/credit-cards/calculations/credit-calculation.service.spec.ts` — new tests FAIL
  - **TDD**: RED step

- [x] T-018 GREEN: Implement `calculateMinimumPayment(input: MinimumPaymentInput): Decimal`. Formula: `formulaA = revolvingBalance.mul(0.015).add(periodInterest)`, `formulaB = creditLimit.mul(0.0125)`, `result = max(formulaA, formulaB)`, `capped = min(result, statementBalance)`. Zero balance → return `Decimal(0)`. Round final to 2 decimal places. Run tests → pass.
  - **Files**: `src/credit-cards/calculations/credit-calculation.service.ts`
  - **Dependencies**: T-017
  - **Verification**: `bun run test src/credit-cards/calculations/credit-calculation.service.spec.ts` — ALL pass
  - **TDD**: GREEN

- [x] T-019 RED: Write failing unit tests for `CreditCalculationService.calculatePaymentDueDate`. Test: standard 20-day offset (Oct 15 + 20 = Nov 4); custom 15-day offset (Nov 1 + 15 = Nov 16); Saturday Nov 7 2026 → Monday Nov 9; Sunday Nov 8 → Monday Nov 9; holiday Sep 16 2026 → Sep 17; holiday+weekend (Friday Sep 16 2026 → Monday Sep 19 — note: Sep 16 2026 is a Wednesday, adjust test to use a Friday holiday or construct a scenario where holiday + weekend chain); already business day → no change. Use `getMexicanHolidays(year)` to build holiday list.
  - **Files**: `src/credit-cards/calculations/credit-calculation.service.spec.ts` (append)
  - **Dependencies**: T-010 (business-days.util available), T-008 (mexican-holidays available)
  - **Verification**: `bun run test src/credit-cards/calculations/credit-calculation.service.spec.ts` — new tests FAIL
  - **TDD**: RED step

- [x] T-020 GREEN: Implement `calculatePaymentDueDate(cutDate: Date, paymentDueDays: number): Date`. Add `paymentDueDays` to `cutDate`, call `getNextBusinessDay` with `getMexicanHolidays(year)` for the resulting date's year. Handle year boundary (holidays from both years if date crosses Dec→Jan). Run tests → pass.
  - **Files**: `src/credit-cards/calculations/credit-calculation.service.ts`
  - **Dependencies**: T-019
  - **Verification**: `bun run test src/credit-cards/calculations/credit-calculation.service.spec.ts` — ALL pass
  - **TDD**: GREEN

- [x] T-021 RED: Write failing unit tests for `CreditCalculationService.applyPaymentWaterfall`. Test: partial interest (600 payment, 500 interest, 200 commissions → 500 to interest, 100 to commissions, remainder 100 in commissions); full coverage with remainder (2500 payment, 300 interest + 100 commissions + 2000 ordinary → all covered, remainder 0); empty categories (payment with 0 interest, 0 commissions → all to ordinary); payment exceeds all → remainder > 0. Verify order: interest → commissions → ordinary → MSI → MSCI.
  - **Files**: `src/credit-cards/calculations/credit-calculation.service.spec.ts` (append)
  - **Dependencies**: T-018
  - **Verification**: `bun run test src/credit-cards/calculations/credit-calculation.service.spec.ts` — new tests FAIL
  - **TDD**: RED step

- [x] T-022 GREEN: Implement `applyPaymentWaterfall(input: WaterfallInput): WaterfallResult`. Apply payment sequentially: interest, commissions, ordinary, MSI, MSCI. Track applied amounts and remainder. Include `// ASSUMPTION — TODO: Verify against primary Banxico/CONDUSEF source.` comment. Run tests → pass.
  - **Files**: `src/credit-cards/calculations/credit-calculation.service.ts`
  - **Dependencies**: T-021
  - **Verification**: `bun run test src/credit-cards/calculations/credit-calculation.service.spec.ts` — ALL pass
  - **TDD**: GREEN

- [x] T-023 RED: Write failing unit tests for `CreditCalculationService.calculateMsciMonthlyAmount`. Test: principal 6000, rate 0.12, 12 months → monthlyInterest = 60.00, monthlyAmount = 560.00. Triangulate: principal 10000, rate 0.24, 24 months → monthlyInterest = 100.00, monthlyAmount = 516.67.
  - **Files**: `src/credit-cards/calculations/credit-calculation.service.spec.ts` (append)
  - **Dependencies**: T-022
  - **Verification**: `bun run test src/credit-cards/calculations/credit-calculation.service.spec.ts` — new tests FAIL
  - **TDD**: RED step

- [x] T-024 GREEN: Implement `calculateMsciMonthlyAmount(principal: Decimal, rate: Decimal, totalMonths: number): Decimal`. `monthlyPrincipal = principal / totalMonths`, `monthlyInterest = principal × rate / totalMonths`, return `monthlyPrincipal + monthlyInterest`. Include `// ASSUMPTION — TODO` comment. Run tests → pass.
  - **Files**: `src/credit-cards/calculations/credit-calculation.service.ts`
  - **Dependencies**: T-023
  - **Verification**: `bun run test src/credit-cards/calculations/credit-calculation.service.spec.ts` — ALL pass
  - **TDD**: GREEN

- [x] T-025 REFACTOR: Review `CreditCalculationService` for extracted constants (IVA rate 0.16, Banxico percentages 0.015, 0.0125, day-count 360). Extract magic numbers to named constants. Extract `DailyBalancePoint` and input interfaces to the service file. Run ALL calculation tests → must still pass after each refactoring step.
  - **Files**: `src/credit-cards/calculations/credit-calculation.service.ts`
  - **Dependencies**: T-024
  - **Verification**: `bun run test src/credit-cards/calculations/` — ALL pass after refactor
  - **TDD**: REFACTOR step

- [x] T-026 Register `CreditCalculationService` in `CreditCardsModule` providers and exports. Verify `bun run build` compiles.
  - **Files**: `src/credit-cards/credit-cards.module.ts`
  - **Dependencies**: T-025
  - **Verification**: `bun run build` — no TypeScript errors
  - **TDD**: No test (module wiring — verified by build)

## Phase 3: Statement Generation (Orchestrator + Lazy Trigger)

- [x] T-027 RED: Write failing unit tests for `StatementGenerationService.generatePending`. Test scenarios with mocked `PrismaService` (tx mock) and mocked `CreditCalculationService`: (1) no-op when `CREDIT_CARD_REACTIVE_ENABLED=false`; (2) single period generation (cut date passed, no prior statement → 1 statement created with frozen fields); (3) multi-period catch-up (3 missed periods → 3 statements created); (4) idempotency (existing statement for period → skip, no duplicate); (5) cut day 31 in February → period end Feb 28; (6) no transactions in period → statement still generated with carried-forward balance. Verify `tx.cardStatement.create` called N times with `isGenerated: true`. Verify `tx.transaction.updateMany` called for linking.
  - **Files**: `src/card-statements/statement-generation.service.spec.ts` (create), `src/card-statements/statement-generation.service.ts` (create — stub with empty `generatePending` returning `Promise.resolve()`)
  - **Dependencies**: T-026
  - **Verification**: `bun run test src/card-statements/statement-generation.service.spec.ts` — FAIL (RED)
  - **TDD**: RED step — 6 spec scenarios

- [x] T-028 GREEN + TRIANGULATE: Implement `StatementGenerationService.generatePending(profileId: string): Promise<void>`. Inject `PrismaService`, `CreditCalculationService`, `ConfigService`. Check feature flag → return early if false. Find all credit cards for profile. For each card: `prisma.$transaction` → find latest statement → compute missed periods (respect `CREDIT_CARD_MAX_CATCH_UP_PERIODS`) → for each period: idempotency check, query transactions by date range, link transactions via `updateMany`, calculate totals via `CreditCalculationService`, advance active installment plans (`currentMonth++`, transition to COMPLETED if reached totalMonths), create `CardStatement` with `isGenerated: true`. Run tests → pass.
  - **Files**: `src/card-statements/statement-generation.service.ts`
  - **Dependencies**: T-027
  - **Verification**: `bun run test src/card-statements/statement-generation.service.spec.ts` — ALL pass
  - **TDD**: GREEN + TRIANGULATE — 6 scenarios force real orchestration logic

- [x] T-029 REFACTOR: Extract period computation helper (`computeMissedPeriods(lastStatement, cutDay, now, maxCatchUp)`) and cut-day-in-short-month helper (`getEffectiveCutDay(cutDay, year, month)`) into private methods or a pure utility. Run tests → still pass.
  - **Files**: `src/card-statements/statement-generation.service.ts`
  - **Dependencies**: T-028
  - **Verification**: `bun run test src/card-statements/statement-generation.service.spec.ts` — ALL pass
  - **TDD**: REFACTOR step

- [x] T-030 Register `StatementGenerationService` in `CardStatementsModule` providers and exports. Import `CreditCardsModule` to get `CreditCalculationService`. Verify `bun run build`.
  - **Files**: `src/card-statements/card-statements.module.ts`
  - **Dependencies**: T-029
  - **Verification**: `bun run build` — no errors
  - **TDD**: No test (module wiring)

- [x] T-031 RED: Write failing unit test for `CardStatementsController.findAll` — verify it calls `statementGenerationService.generatePending(profileId)` before delegating to `cardStatementsService.findAllByProfile`. Mock both services.
  - **Files**: `src/card-statements/card-statements.controller.spec.ts` (create or extend if exists)
  - **Dependencies**: T-030
  - **Verification**: `bun run test src/card-statements/card-statements.controller.spec.ts` — FAIL (RED)
  - **TDD**: RED step

- [x] T-032 GREEN: Modify `CardStatementsController.findAll` to inject `StatementGenerationService` and call `generatePending(profileId)` before `findAllByProfile`. Run test → pass.
  - **Files**: `src/card-statements/card-statements.controller.ts`
  - **Dependencies**: T-031
  - **Verification**: `bun run test src/card-statements/card-statements.controller.spec.ts` — pass
  - **TDD**: GREEN

- [x] T-033 Modify `CardStatementsService.create` — when feature flag is on, reject caller-supplied `balance`, `minPayment`, `noInterestPayment`, `interestAmount` (generation-only fields). When flag off, keep existing behavior. Add test for rejection when flag on.
  - **Files**: `src/card-statements/card-statements.service.ts`, `src/card-statements/card-statements.service.spec.ts`
  - **Dependencies**: T-032
  - **Verification**: `bun run test src/card-statements/card-statements.service.spec.ts` — new test passes
  - **TDD**: RED (write test for rejection) → GREEN (implement guard) → verify

- [x] T-034 Modify `CardStatementDTO`s: `CardStatementResponseDto` add `paymentDueDate`, `paidAmount`, `remainingBalance`, `isGenerated`, `updatedAt`. `UpdateCardStatementDto` restrict to mutable fields only (`paidAmount`, `isPaid`); frozen fields rejected. `CreateCardStatementDto` mark calculated fields as deprecated/forbidden when flag on.
  - **Files**: `src/card-statements/dto/card-statement.dto.ts`
  - **Dependencies**: T-033
  - **Verification**: `bun run build` — DTO types compile. Manual: Swagger docs show new fields.
  - **TDD**: No unit test (DTO structural definition — verified by build + Swagger inspection)

## Phase 4: Transaction Changes (Over-Limit + InstallmentPlan + Waterfall)

- [x] T-035 RED: Write failing unit tests for over-limit validation in `TransactionsService.create`. Test scenarios with mocked PrismaService: (1) EXPENSE on CREDIT within limit → accepted; (2) EXPENSE on CREDIT at exact limit → accepted; (3) EXPENSE on CREDIT over limit → `BadRequestException`; (4) EXPENSE on CREDIT over limit with tolerance → rejected if exceeds limit + tolerance; (5) EXPENSE on CREDIT within tolerance → accepted; (6) EXPENSE on DEBIT → bypasses validation; (7) PAYMENT on CREDIT → bypasses validation; (8) TRANSFER from CREDIT → bypasses; (9) saldo a favor spending (-1000 + 5000 = 4000 <= 10000) → accepted; (10) flag off → no validation (balance exceeds limit accepted). Gate: `CREDIT_CARD_REACTIVE_ENABLED=true` for scenarios 1–9, `false` for scenario 10.
  - **Files**: `src/transactions/transactions.service.spec.ts` (append to existing)
  - **Dependencies**: T-006 (schema with `overLimitTolerance` on CreditCard)
  - **Verification**: `bun run test src/transactions/transactions.service.spec.ts` — new tests FAIL (RED)
  - **TDD**: RED step — 10 spec scenarios

- [x] T-036 GREEN: Implement `validateOverLimit(tx, accountId, amount)` private method in `TransactionsService`. Inside `create()`'s existing `prisma.$transaction`, after `validateAccountOwnership`, before `tx.transaction.create`: if `dto.type === "EXPENSE" && account.type === "CREDIT" && flag enabled`, load `CreditCard` via `tx.creditCard.findFirst({ where: { accountId } })`, check `account.balance + amount > creditLimit + overLimitTolerance`, throw `BadRequestException` with clear message. Run tests → pass.
  - **Files**: `src/transactions/transactions.service.ts`
  - **Dependencies**: T-035
  - **Verification**: `bun run test src/transactions/transactions.service.spec.ts` — ALL pass
  - **TDD**: GREEN — 10 scenarios

- [ ] T-037 RED: Write failing unit tests for `InstallmentPlan` creation in `TransactionsService.create`. Test: (1) MSI 12 months on 6000 → `installmentPlan.create` called with `type: MSI`, `totalMonths: 12`, `currentMonth: 0`, `monthlyAmount: 500.00`, `interestRate: null`, `status: ACTIVE`; (2) MSCI 12 months on 6000 at 0.12 → `monthlyAmount: 560.00`, `interestRate: 0.1200`; (3) no `msiMonths` → no `installmentPlan.create` call; (4) flag off → no plan created even with `msiMonths`. Verify plan created inside same `prisma.$transaction`.
  - **Files**: `src/transactions/transactions.service.spec.ts` (append)
  - **Dependencies**: T-036
  - **Verification**: `bun run test src/transactions/transactions.service.spec.ts` — new tests FAIL
  - **TDD**: RED step

- [ ] T-038 GREEN: Implement `createInstallmentPlan(tx, transactionId, dto)` private method. When `dto.msiMonths && dto.msiType && flag enabled`: calculate `monthlyAmount` (MSI: `amount / msiMonths`; MSCI: `CreditCalculationService.calculateMsciMonthlyAmount(amount, dto.msiRate, msiMonths)`). Call `tx.installmentPlan.create({ data: { transactionId, type, totalMonths, currentMonth: 0, monthlyAmount, interestRate, status: "ACTIVE" } })`. Run tests → pass.
  - **Files**: `src/transactions/transactions.service.ts`
  - **Dependencies**: T-037, T-026 (CreditCalculationService available)
  - **Verification**: `bun run test src/transactions/transactions.service.spec.ts` — ALL pass
  - **TDD**: GREEN

- [ ] T-039 RED: Write failing unit tests for PAYMENT waterfall to statement. Test: (1) PAYMENT on CREDIT with unpaid statement → `cardStatement.update` called with `paidAmount: { increment: amount }`, `remainingBalance` updated, `isPaid` flipped when fully paid, `updatedAt` set; (2) PAYMENT on CREDIT with no unpaid statement → no statement update (saldo a favor created); (3) flag off → no waterfall applied. Mock `CreditCalculationService.applyPaymentWaterfall` to return known `WaterfallResult`.
  - **Files**: `src/transactions/transactions.service.spec.ts` (append)
  - **Dependencies**: T-038
  - **Verification**: `bun run test src/transactions/transactions.service.spec.ts` — new tests FAIL
  - **TDD**: RED step

- [ ] T-040 GREEN: Implement `applyPaymentToStatement(tx, destAccountId, amount)` private method. When flag enabled && destAccount.type === "CREDIT": find latest unpaid statement (`isPaid: false`, ordered by `periodEnd desc`). If none → return (saldo a favor). Query period transactions, compute category totals, call `CreditCalculationService.applyPaymentWaterfall`, update `cardStatement` with `paidAmount`, `remainingBalance`, `isPaid`, `updatedAt`. Run tests → pass.
  - **Files**: `src/transactions/transactions.service.ts`
  - **Dependencies**: T-039
  - **Verification**: `bun run test src/transactions/transactions.service.spec.ts` — ALL pass
  - **TDD**: GREEN

- [ ] T-041 Modify `TransactionsModule` to import `CreditCardsModule` (for `CreditCalculationService` injection). Verify `bun run build`.
  - **Files**: `src/transactions/transactions.module.ts`
  - **Dependencies**: T-040
  - **Verification**: `bun run build` — no errors
  - **TDD**: No test (module wiring)

- [ ] T-042 Modify `CreateTransactionDto`: add `msiMonths?: number` (`@IsOptional()`, `@IsInt()`, `@Min(1)`, `@Max(36)`), `msiType?: InstallmentPlanType` (`@IsOptional()`, `@IsEnum(InstallmentPlanType)`), `msiRate?: number` (`@IsOptional()`, `@IsNumber()` — for MSCI), `commissionType?: CommissionType` (`@IsOptional()`, `@IsEnum(CommissionType)`). Modify `TransactionResponseDto`: add `statementId?: string`, `commissionType?: CommissionType`. Add `@ApiProperty` decorators with examples.
  - **Files**: `src/transactions/dto/transaction.dto.ts`
  - **Dependencies**: T-006
  - **Verification**: `bun run build` — DTOs compile. Swagger docs show new optional fields.
  - **TDD**: No unit test (DTO structural — verified by build + Swagger)

## Phase 5: Dashboard / DTOs / Computed Fields

- [ ] T-043 RED: Write failing unit tests for `availableCredit` computed field in `CreditCardsService`. Test: (1) positive available credit (10000 - 3000 = 7000.00); (2) fully utilized (10000 - 10000 = 0.00); (3) over-limit (10000 - 12000 = -2000.00); (4) saldo a favor (10000 - (-1000) = 11000.00); (5) decimal rounding (10000 - 3333.33 = 6666.67). Verify response DTO includes `availableCredit`, `currentBalance`, `nextPaymentDueDate`.
  - **Files**: `src/credit-cards/credit-cards.service.spec.ts` (append to existing)
  - **Dependencies**: T-006
  - **Verification**: `bun run test src/credit-cards/credit-cards.service.spec.ts` — new tests FAIL
  - **TDD**: RED step — 5 spec scenarios

- [ ] T-044 GREEN: Implement `toResponseDto(card, account)` private method in `CreditCardsService`. Compute `availableCredit = creditLimit - account.balance` (Decimal, rounded to 2dp). Map `currentBalance = account.balance`. Query latest unpaid statement for `nextPaymentDueDate` (null if none). Modify `findAll` and `findOne` to use `toResponseDto`. Run tests → pass.
  - **Files**: `src/credit-cards/credit-cards.service.ts`
  - **Dependencies**: T-043
  - **Verification**: `bun run test src/credit-cards/credit-cards.service.spec.ts` — ALL pass
  - **TDD**: GREEN

- [ ] T-045 Modify `CreditCardDTO`s: `CreateCreditCardDto` replace `paymentDay` with `paymentDueDays` (`@IsOptional()`, `@IsInt()`, `@Min(1)`, `@Max(31)`), add optional `overLimitTolerance`. `UpdateCreditCardDto` same. `CreditCardResponseDto` add `availableCredit`, `currentBalance`, `nextPaymentDueDate`, `paymentDueDays`. Keep `paymentDay` as deprecated optional for backward compat.
  - **Files**: `src/credit-cards/dto/credit-card.dto.ts`
  - **Dependencies**: T-044
  - **Verification**: `bun run build` — DTOs compile. Swagger shows new fields.
  - **TDD**: No unit test (DTO structural)

- [ ] T-046 RED: Write failing unit test for `DashboardService.getSummary` — verify it calls `statementGenerationService.generatePending(profile.id)` before the `Promise.all` that fetches credit cards. Mock `StatementGenerationService` and `PrismaService`.
  - **Files**: `src/dashboard/dashboard.service.spec.ts` (append to existing)
  - **Dependencies**: T-030
  - **Verification**: `bun run test src/dashboard/dashboard.service.spec.ts` — new test FAIL
  - **TDD**: RED step

- [ ] T-047 GREEN: Modify `DashboardService.getSummary` to inject `StatementGenerationService` and call `generatePending(profile.id)` before `Promise.all`. Run test → pass.
  - **Files**: `src/dashboard/dashboard.service.ts`
  - **Dependencies**: T-046
  - **Verification**: `bun run test src/dashboard/dashboard.service.spec.ts` — pass
  - **TDD**: GREEN

- [ ] T-048 RED: Write failing unit test for `DashboardService.computeCreditOverview` — verify it uses `paymentDueDate` (not `periodEnd`) for `nextPaymentDue`, and exposes `noInterestPayment` and `interestAmount` from latest statement. Mock PrismaService.
  - **Files**: `src/dashboard/dashboard.service.spec.ts` (append)
  - **Dependencies**: T-047
  - **Verification**: `bun run test src/dashboard/dashboard.service.spec.ts` — new test FAIL
  - **TDD**: RED step

- [ ] T-049 GREEN: Modify `computeCreditOverview` to use `statement.paymentDueDate` for `nextPaymentDue` field. Expose `noInterestPayment` and `interestAmount` from latest unpaid statement. Run test → pass.
  - **Files**: `src/dashboard/dashboard.service.ts`
  - **Dependencies**: T-048
  - **Verification**: `bun run test src/dashboard/dashboard.service.spec.ts` — pass
  - **TDD**: GREEN

- [ ] T-050 Modify `DashboardModule` to import `CardStatementsModule` (for `StatementGenerationService`). Verify `bun run build`.
  - **Files**: `src/dashboard/dashboard.module.ts`
  - **Dependencies**: T-049
  - **Verification**: `bun run build` — no errors
  - **TDD**: No test (module wiring)

- [ ] T-051 Modify `CreditCardSummary` in `dashboard.dto.ts`: add `noInterestPayment?: number`, `interestAmount?: number`, `paymentDueDate?: Date`. Add `@ApiProperty` decorators.
  - **Files**: `src/dashboard/dto/dashboard.dto.ts`
  - **Dependencies**: T-049
  - **Verification**: `bun run build` — DTO compiles
  - **TDD**: No unit test (DTO structural)

- [ ] T-052 RED: Write failing unit test for `BanksService.findCreditCardsByBank` — verify response includes `availableCredit` and `paymentDueDays` for each card. Mock PrismaService.
  - **Files**: `src/banks/banks.service.spec.ts` (append to existing)
  - **Dependencies**: T-044
  - **Verification**: `bun run test src/banks/banks.service.spec.ts` — new test FAIL
  - **TDD**: RED step

- [ ] T-053 GREEN: Modify `BanksService.findCreditCardsByBank` to map responses with `availableCredit = creditLimit - account.balance` and `paymentDueDays`. Run test → pass.
  - **Files**: `src/banks/banks.service.ts`
  - **Dependencies**: T-052
  - **Verification**: `bun run test src/banks/banks.service.spec.ts` — pass
  - **TDD**: GREEN

- [ ] T-054 Modify `BankCreditCardResponseDto` in `banks/dto/bank-sub-resources.dto.ts`: add `availableCredit`, `paymentDueDays`. Add `@ApiProperty` decorators.
  - **Files**: `src/banks/dto/bank-sub-resources.dto.ts`
  - **Dependencies**: T-053
  - **Verification**: `bun run build` — DTO compiles
  - **TDD**: No unit test (DTO structural)

## Phase 6: Feature Flag Wiring + Integration

- [ ] T-055 Add `CREDIT_CARD_REACTIVE_ENABLED=false` and `CREDIT_CARD_MAX_CATCH_UP_PERIODS=12` to `.env.example`. Document in AGENTS.md environment variables table.
  - **Files**: `.env.example`, `AGENTS.md` (read-only reference for existing table format — only edit env vars table section)
  - **Dependencies**: T-006
  - **Verification**: `.env.example` contains both vars. `bun run build` still passes.
  - **TDD**: No test (config file)

- [ ] T-056 Verify feature flag reads in all gated paths: `StatementGenerationService.generatePending` (early return if false), `TransactionsService.validateOverLimit` (skip if false), `TransactionsService.createInstallmentPlan` (skip if false), `TransactionsService.applyPaymentToStatement` (skip if false). Use `ConfigService.get<string>("CREDIT_CARD_REACTIVE_ENABLED")` parsed to boolean. Verify `availableCredit` and `paymentDueDate` are NOT gated (always computed/returned).
  - **Files**: `src/card-statements/statement-generation.service.ts`, `src/transactions/transactions.service.ts`
  - **Dependencies**: T-040, T-049
  - **Verification**: `bun run build` — no errors. `bun run test` — all existing tests pass.
  - **TDD**: No new test (verification of existing gating — covered by T-035 scenario 10, T-037 scenario 4, T-039 scenario 3)

- [ ] T-057 RED: Write integration test for full statement generation lifecycle: transactions → statement → interest → minPayment → paymentDueDate. Use `@nestjs/testing` module with REAL `CreditCalculationService` (not mocked) and mocked Prisma. Seed: card with cutDay=15, 3 EXPENSE transactions in period. Verify: statement created with correct `balance`, `minPayment`, `noInterestPayment`, `interestAmount`, `paymentDueDate`, `isGenerated: true`. Verify transactions linked via `statementId`.
  - **Files**: `src/card-statements/statement-generation.integration.spec.ts` (create)
  - **Dependencies**: T-056
  - **Verification**: `bun run test src/card-statements/statement-generation.integration.spec.ts` — FAIL (RED)
  - **TDD**: RED step — integration layer

- [ ] T-058 GREEN: Fix any issues in `StatementGenerationService` integration path. Run integration test → pass. If test passes immediately (orchestrator already correct), add triangulation: second test with MSCI plan to verify mensualidad in balance + PNGI.
  - **Files**: `src/card-statements/statement-generation.service.ts` (if fixes needed)
  - **Dependencies**: T-057
  - **Verification**: `bun run test src/card-statements/statement-generation.integration.spec.ts` — ALL pass
  - **TDD**: GREEN + TRIANGULATE

- [ ] T-059 RED: Write integration test for installment plan lifecycle: purchase with MSI 3 months → 3 statement generations → currentMonth advances 0→1→2→3, status transitions to COMPLETED on 3rd. Verify mensualidad included in each statement balance. Verify COMPLETED plan excluded from 4th statement.
  - **Files**: `src/card-statements/statement-generation.integration.spec.ts` (append)
  - **Dependencies**: T-058
  - **Verification**: `bun run test src/card-statements/statement-generation.integration.spec.ts` — new test FAIL
  - **TDD**: RED step — integration layer

- [ ] T-060 GREEN: Fix `StatementGenerationService` installment advancement logic if needed. Run integration test → pass.
  - **Files**: `src/card-statements/statement-generation.service.ts` (if fixes needed)
  - **Dependencies**: T-059
  - **Verification**: `bun run test src/card-statements/statement-generation.integration.spec.ts` — ALL pass
  - **TDD**: GREEN

- [ ] T-061 Run full test suite: `bun run test`. Verify ALL tests pass (existing + new). Run `bun run build` — verify no TypeScript errors under strict mode. Run `bun run check` (Biome) — verify linting passes.
  - **Files**: None (verification only)
  - **Dependencies**: T-060
  - **Verification**: `bun run test` — 0 failures. `bun run build` — success. `bun run check` — clean.
  - **TDD**: Final verification gate — no new tests, confirms all prior TDD cycles are coherent

- [ ] T-062 Manual verification: start dev server with `CREDIT_CARD_REACTIVE_ENABLED=false`. Verify: GET /api/credit-cards returns `availableCredit` (not gated). POST /api/transactions with EXPENSE over limit → accepted (no validation). GET /api/dashboard/summary → no statement generation. Then toggle to `true`: POST /api/transactions EXPENSE over limit → 400. GET /api/dashboard/summary after cut date → statement generated.
  - **Files**: None (manual runtime check)
  - **Dependencies**: T-061
  - **Verification**: Manual confirmation of feature flag on/off behavior matches spec scenarios.
  - **TDD**: No test (manual E2E verification — spec scenarios checked by hand)