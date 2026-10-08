# Proposal: Credit Card Reactive Behavior

## Intent

Savy currently models credit cards as CRUD-only: the frontend supplies `balance`, `minPayment`, `noInterestPayment`, and `interestAmount` on statement creation, and the API calculates nothing. There is no statement generation on cut date, no interest calculation, no minimum-payment formula, no payment-due-date derivation, no MSI/MSCI tracking, no over-limit validation, and no link between statements and the transactions that compose them.

This change makes credit cards behave like real Mexican credit cards: on app open, the API detects if a cut date has passed since the last check and generates a frozen `CardStatement` with calculated fields using Banxico/CONDUSEF formulas. It introduces per-transaction installment plans (MSI/MSCI), over-limit spending protection, available credit as a computed field, and the statement-transaction link that makes statements auditable.

The user need is trust: a personal finance app that claims to track credit cards but cannot calculate interest or generate statements is a spreadsheet with extra steps.

## Scope

### In Scope

1. **Statement generation (lazy strategy)** — On read (dashboard / card-statements endpoint), detect if a cut date has passed since the last generated statement and create the missing `CardStatement` rows. Frozen snapshot: totals do not change after generation.
2. **Interest calculation** — Average daily balance method per Banxico: `interest = avgDailyBalance × (annualRate / 360) × periodDays`. IVA 16% applied on interest. Charged only when previous-period payment < PNGI.
3. **Minimum payment** — Banxico Circular 13/2011 formula: `max(1.5% × revolvingBalance + periodInterest + IVA, 1.25% × creditLimit)`. Capped at balance if formula exceeds it.
4. **Payment due date** — `paymentDueDate = cutDate + paymentDueDays` (default 20 natural days). If falls on non-business day, move to next business day. Replaces the fixed `paymentDay` field with `paymentDueDays` (offset from cut).
5. **PNGI (pago para no generar intereses)** — Total saldo deudor minus MSI/MSCI plan balances plus the current mensualidad of those plans.
6. **Statement-transaction link** — Add `statementId` FK to `Transaction`. At statement generation, assign period transactions to the statement. Post-statement transactions go to the next period.
7. **Over-limit validation** — In `TransactionsService`, reject `EXPENSE` on `CREDIT` accounts when `balance + amount > creditLimit`. Configurable tolerance (default 0).
8. **Available credit as computed field** — Return `availableCredit = creditLimit - account.balance` in `CreditCard` responses. Do NOT change `account.balance` semantics.
9. **Schema changes to `CardStatement`** — Add `paymentDueDate` (DateTime), `updatedAt`, `paidAmount`, `remainingBalance`. Frozen-on-generation: `balance`, `minPayment`, `noInterestPayment`, `interestAmount` are immutable after creation; `paidAmount` and `isPaid` are mutable.
10. **New entity: `InstallmentPlan`** — Represents MSI/MSCI on a single transaction. Fields: `transactionId`, `type` (MSI / MSCI), `totalMonths`, `currentMonth`, `monthlyAmount`, `interestRate` (for MSCI, null for MSI), `status` (ACTIVE / COMPLETED / CANCELLED). At statement generation, the current month's mensualidad is included in the statement balance and PNGI.
11. **MSI mechanics** — Full purchase amount consumes credit immediately (already true via `account.balance`). Monthly partiality appears in each subsequent statement. If a mensualidad is unpaid, it generates regular interest.
12. **MSCI mechanics (simplified v1)** — Same lifecycle as MSI but with a per-plan interest rate. Simplified amortization: simple interest divided by months (`monthlyInterest = principal × rate / totalMonths`). Research gap noted: exact amortization method is under-documented in primary sources. TODO marker for precision refinement.
13. **Commissions (simplified)** — Model as `EXPENSE` transactions with a `commissionType` discriminator (`ANNUAL_FEE`, `LATE_PAYMENT`, `CASH_ADVANCE`). Reuses existing balance flow. No separate entity.
14. **Partial payments — waterfall (assumption pending verification)** — Payment application order: interest → commissions → ordinary balance → MSI mensualidad → MSCI mensualidad. Research gap: exact waterfall not confirmed from primary Banxico/CONDUSEF sources. Marked as assumption; design phase must verify or accept the assumption explicitly.
15. **Saldo a favor (negative balance)** — Allow `account.balance < 0` for `CREDIT` accounts (overpayment). Review `TransactionsService` `PAYMENT` validation. Next purchases consume saldo a favor first (natural via `account.balance` arithmetic).

### Out of Scope

- Credit bureau reporting (historial crediticio) — not a personal finance API concern.
- Cash advance specific logic (retiro en cajero, ATM fee + immediate interest) — deferred; commission type reserved but logic not implemented.
- Card cancellation mid-MSI-plan — research gap, deferred to a follow-up change.
- Multiple cards per account — 1:1 `Account ↔ CreditCard` stays.
- Statement re-generation / correction flow — frozen snapshots are immutable; corrections are a future change.
- Automatic payment scheduling / reminders — frontend concern.
- Migration of existing manually-created statements — existing rows keep nulls; new generation populates new fields.

## Capabilities

> Research note: `openspec/specs/` is currently empty — this is a greenfield spec set.

### New Capabilities

- `statement-generation`: Lazy detection and generation of `CardStatement` rows on cut date, with calculated balance, minimum payment, PNGI, interest, and payment due date. Frozen snapshot semantics. Multi-period catch-up. Idempotency guard.
- `interest-calculation`: Average daily balance interest per Banxico formula, IVA 16%, triggered only when previous-period payment < PNGI. Includes saldo a favor handling.
- `minimum-payment-calc`: Banxico Circular 13/2011 minimum payment formula with balance cap.
- `payment-due-date`: Derivation of payment due date from cut date + offset, with non-business-day adjustment.
- `installment-plans`: MSI and MSCI per-transaction installment tracking. Current mensualidad included in statement balance and PNGI. Lifecycle: ACTIVE → COMPLETED / CANCELLED.
- `over-limit-validation`: Rejection of `EXPENSE` on `CREDIT` accounts when `balance + amount > creditLimit ± tolerance`.
- `available-credit`: Computed `availableCredit` field on `CreditCard` responses.
- `commissions`: Commission modeling via typed `EXPENSE` transactions (`ANNUAL_FEE`, `LATE_PAYMENT`, `CASH_ADVANCE`).

### Modified Capabilities

None — `openspec/specs/` is empty; there are no existing spec-level capabilities to modify. All changes above are new capabilities. Existing CRUD behavior in `CreditCardsModule` and `CardStatementsModule` will be extended, but the spec-level contracts are being introduced here for the first time.

## Approach

### High-level strategy

1. **Schema first** — Extend `CreditCard`, `CardStatement`, `Transaction`; add `InstallmentPlan` model and `CommissionType` enum. One migration, additive (all new fields nullable or defaulted).

2. **Calculation engine** — Create a pure, injectable `CreditCalculationService` (in `src/credit-cards/` or a shared `src/credit-cards/calculations/` subfolder) with no Prisma dependency. Functions: `calculateAverageDailyBalance`, `calculateInterest`, `calculateMinimumPayment`, `calculatePngi`, `calculatePaymentDueDate`, `getNextBusinessDay`. Unit-tested in isolation with Decimal arithmetic (never Float).

3. **Generation orchestrator** — `StatementGenerationService` in `src/card-statements/` coordinates: find last statement → detect missed cut dates → for each missing period: query transactions by date range → assign `statementId` → calculate totals via `CreditCalculationService` → persist frozen `CardStatement`. Idempotency: unique constraint on `[creditCardId, periodStart]` or a "last generated period" check.

4. **Lazy trigger** — `DashboardService.computeCreditOverview` and `CardStatementsController.findAll` call `StatementGenerationService.generatePending(profileId)` before reading. No cron, no background job — matches the lazy strategy from `savy-planning.md`.

5. **Transaction-time validation** — `TransactionsService.create` gains a CREDIT-path: if `account.type === CREDIT` and `type === EXPENSE`, load the `CreditCard`, check `balance + amount > creditLimit + tolerance`, throw `BadRequestException` if exceeded. Also: if `msiMonths` provided on the DTO, create the `InstallmentPlan` row.

6. **Computed fields** — `CreditCardsService.findOne` / `findAll` map responses to include `availableCredit = creditLimit - account.balance`. DTO layer, not storage.

7. **Payment waterfall** — `TransactionsService` PAYMENT on CREDIT account updates statement `paidAmount` / `isPaid` / `remainingBalance` following the documented order (assumption pending verification).

### Why each change

| Change | Why |
|---|---|
| Lazy statement generation | Matches `savy-planning.md` Priority 4 lazy strategy. No cron infrastructure needed. User opens app → API catches up. |
| Interest via avg daily balance | Banxico primary source. Simplified methods produce numbers that don't match bank statements, eroding trust. |
| Banxico minimum payment formula | Regulatory requirement (Circular 13/2011). Hardcoded `1.5%` or flat amounts are wrong. |
| `paymentDueDays` replacing `paymentDay` | Fixed day-of-month breaks on short months and doesn't match real contracts (20 days after cut). |
| PNGI | Without it, interest is charged on MSI balances that shouldn't generate interest. Core to "no interest if you pay in full." |
| `statementId` FK | Explicit membership > date-range derivation. Enables statement detail views, corrections, and auditability. One-way architectural decision. |
| Over-limit validation | Without it, `EXPENSE` on CREDIT can push past `-creditLimit` silently. Users see negative available credit with no warning. |
| `availableCredit` computed | Frontend needs it for every card display. Currently only in dashboard. Pushing it to the card response eliminates a second call. |
| `CardStatement.updatedAt` + `paidAmount` | Partial payments mutate the statement. Without `updatedAt`, there's no audit trail. Without `paidAmount`, you can't compute `remainingBalance`. |
| `InstallmentPlan` entity | MSI/MSCI are per-purchase, not card-level. `CreditCard.noInterestMonths` is a card promo, not transaction tracking. |
| Commissions as typed transactions | Reuses balance flow. No new table. A separate entity would duplicate what `Transaction` already does. |
| Saldo a favor | Real cards allow overpayment. Current `PAYMENT` validation may reject valid payments. |

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `prisma/schema.prisma` | Modified | `CreditCard`: replace `paymentDay` with `paymentDueDays`. `CardStatement`: add `paymentDueDate`, `updatedAt`, `paidAmount`, `remainingBalance`. `Transaction`: add `statementId?`, `commissionType?`. New `InstallmentPlan` model, `CommissionType` enum, `InstallmentPlanType` enum, `InstallmentPlanStatus` enum. |
| `prisma/migrations/` | New | One additive migration. All new fields nullable or defaulted. |
| `src/credit-cards/credit-cards.service.ts` | Modified | Computed `availableCredit` in responses. Generation entry point delegation. |
| `src/credit-cards/dto/credit-card.dto.ts` | Modified | Response DTO: `availableCredit`, `currentBalance`, `nextPaymentDueDate`. Create DTO: `paymentDueDays` replaces `paymentDay`. |
| `src/credit-cards/calculations/` | New | `CreditCalculationService` — pure calculation functions, no Prisma. |
| `src/card-statements/card-statements.service.ts` | Modified | Generation logic, calculation delegation, transaction linking. CRUD create no longer accepts caller-supplied calculated fields (generated only). |
| `src/card-statements/statement-generation.service.ts` | New | Orchestrator: detect missed periods, generate frozen statements, link transactions. |
| `src/card-statements/dto/card-statement.dto.ts` | Modified | Response: `paymentDueDate`, `paidAmount`, `remainingBalance`, `transactions?`. Create DTO: removed (generation only) or restricted to admin override. |
| `src/transactions/transactions.service.ts` | Modified | Over-limit validation on CREDIT EXPENSE. `statementId` assignment awareness. `InstallmentPlan` creation when `msiMonths` set. PAYMENT waterfall to statement. |
| `src/transactions/dto/transaction.dto.ts` | Modified | `msiMonths?`, `msiType?` (MSI/MSCI), `statementId?` (read-only), `commissionType?`. |
| `src/dashboard/dashboard.service.ts` | Modified | `computeCreditOverview` uses `paymentDueDate` (not `periodEnd`), exposes `noInterestPayment` and `interestAmount`. Calls `generatePending` before read. |
| `src/dashboard/dto/dashboard.dto.ts` | Modified | `CreditCardSummary` new fields. |
| `src/banks/banks.service.ts` | Modified | `findCreditCardsByBank` may include `availableCredit`. |
| `src/app.module.ts` | Modified | Register new services/providers. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Interest calculation mismatch with bank statements (avg daily balance precision, day-count conventions) | High | Use Decimal throughout. Document assumptions. Accept that bank-specific rounding may differ by cents. Unit tests with known examples from Banxico comparator. |
| Breaking schema change: `paymentDay` → `paymentDueDays` on live DB | Medium | Migration backfills `paymentDueDays = 20` (default) and keeps `paymentDay` as nullable deprecated during transition. DTO accepts both during migration window. |
| Payment waterfall is an unverified assumption (no primary source) | High | Mark as explicit assumption in spec and code. Design phase must confirm or user accepts. Waterfall isolated in a single function for easy replacement. |
| MSCI simplified amortization is imprecise | Medium | TODO marker in code. Simple interest ÷ months is a known simplification. Documented gap; precision refinement deferred. |
| Lazy generation performance on first read after long inactivity (multiple missed periods) | Medium | Batch generation in a single transaction. Limit catch-up to N periods (configurable). Benchmarked in verify phase. |
| Over-limit check adds a `CreditCard` query per CREDIT EXPENSE | Low | 1:1 relation, indexed on `accountId`. Single indexed lookup. Acceptable. |
| Dashboard contract change: `periodEnd` → `paymentDueDate` breaks frontend | Medium | Field added, `periodEnd` retained. Frontend migration window. |
| `CardStatement` immutability vs partial payments | Medium | Frozen fields (`balance`, `minPayment`, `noInterestPayment`, `interestAmount`) are immutable. Mutable fields (`paidAmount`, `isPaid`, `remainingBalance`, `updatedAt`) track payment progress. |
| `InstallmentPlan` + `Transaction` + `CardStatement` interaction complexity | High | Spec phase must define exact state machine. Unit tests for every transition. Integration test for full lifecycle: purchase → N statements → completion. |

## Rollback Plan

1. **Schema** — The migration is additive (new fields nullable/defaulted, new tables). Rollback: create a down-migration dropping `InstallmentPlan`, `CommissionType` enum, and new columns. `paymentDay` is retained as nullable during transition, so reverting the `paymentDueDays` change is a DTO revert, not a data loss.
2. **Code** — Feature-flag the generation trigger (`generatePending`) behind an env var `CREDIT_CARD_REACTIVE_ENABLED=false`. All new validation (`over-limit`, `InstallmentPlan` creation) gated behind the same flag. Disabling the flag returns the API to current CRUD-only behavior.
3. **Statements** — Generated statements are identifiable by `createdAt` after the feature ship date. A cleanup script can delete auto-generated statements if needed: `DELETE FROM card_statements WHERE created_at > <ship_date> AND <manual_flag = false>`. Add a `isGenerated Boolean @default(false)` field to distinguish manual vs auto-generated statements.
4. **Frontend contract** — New response fields are additive. Frontend ignores unknown fields. Reverting the API removes them with no frontend breakage.

## Dependencies

- **Prisma migration** — Must run via `DIRECT_URL` (session pooler), not `DATABASE_URL`.
- **No new npm dependencies** — All calculations use `Decimal` (Prisma's `Decimal` or a dedicated decimal lib already available). Business-day logic is pure TS (no holiday API for v1; Mexican holidays hardcoded or configurable).
- **Frontend coordination** — Dashboard contract change (`paymentDueDate`) requires frontend update to display the correct due date. Not a hard blocker (additive field), but should be coordinated.
- **Research gap: payment waterfall** — Design phase dependency. If primary source cannot be found, user must accept the documented assumption before spec finalization.
- **Research gap: MSCI amortization** — Design phase dependency. Simplified approach accepted for v1 with TODO for precision.

## Success Criteria

- [ ] Opening the app after a cut date has passed generates the missing `CardStatement` automatically, with calculated `balance`, `minPayment`, `noInterestPayment`, `interestAmount`, and `paymentDueDate`.
- [ ] Interest calculation matches Banxico comparator examples within ±$0.01 MXN rounding tolerance.
- [ ] Minimum payment matches the Banxico Circular 13/2011 formula on test cases with known expected values.
- [ ] Payment due date is 20 natural days after cut, adjusted to next business day when it falls on a non-business day.
- [ ] `EXPENSE` on a `CREDIT` account that would exceed `creditLimit + tolerance` is rejected with a clear error message.
- [ ] `availableCredit` appears on every `CreditCard` response and equals `creditLimit - account.balance`.
- [ ] Transactions created during a statement period are linked to the generated statement via `statementId`.
- [ ] An MSI purchase with `msiMonths = 12` generates an `InstallmentPlan` and its mensualidad appears in each of the next 12 statements' balance and PNGI.
- [ ] Unit tests pass (`bun run test`) covering: average daily balance, interest with IVA, minimum payment formula, payment due date with business-day adjustment, PNGI with MSI exclusion, over-limit rejection, installment plan lifecycle.
- [ ] Build passes (`bun run build`) with no TypeScript errors under strict mode.
- [ ] Existing CRUD endpoints still work with the feature flag disabled.