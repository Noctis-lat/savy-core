# Exploration: Credit Card Reactive Behavior

## Current State

Savy models credit cards as a 1:1 extension of an `Account` with `type = CREDIT`. Money always moves through the Account's `balance`; `CreditCard` only adds domain-specific metadata. Statements are a separate read model with no link back to individual transactions.

### What EXISTS

**Prisma schema (`prisma/schema.prisma`)**
- `Account.type: AccountType` enum includes `CREDIT`. `Account.balance` is `Decimal(12,2)`, default 0.
- `CreditCard` model (1:1 with Account via `accountId @unique`):
  - `creditLimit Decimal(12,2)`
  - `cutDay Int` (1-31) — fixed day-of-month
  - `paymentDay Int` (1-31) — fixed day-of-month
  - `interestRate Decimal(5,4)` — annual rate as decimal (0.3600 = 36%)
  - `noInterestMonths Int @default(0)` — promotional interest-free period on the CARD, not per transaction
  - `createdAt`, `updatedAt`
  - Relation: `statements CardStatement[]`
- `CardStatement` model:
  - `creditCardId`, `periodStart`, `periodEnd`
  - `balance Decimal(12,2)` — statement balance
  - `minPayment Decimal(12,2)`
  - `noInterestPayment Decimal(12,2)`
  - `interestAmount Decimal @default(0)`
  - `isPaid Boolean @default(false)`
  - `createdAt` only (no `updatedAt`)
  - Index: `@@index([creditCardId, periodEnd])`
- `Transaction` has no `statementId` FK. Statements and transactions are linked only by date range.

**CreditCardsModule (`src/credit-cards/`)**
- Pure CRUD. No business logic beyond ownership scoping.
- `CreditCardsService`: `findAllByProfile`, `findOne`, `create`, `update`, `remove`.
- `create` validates that the account is `type CREDIT` and no existing `CreditCard` is attached.
- `create` stores `creditLimit`, `cutDay`, `paymentDay`, `interestRate`, `noInterestMonths`.
- No computed fields: `available credit` is NOT returned by this service.
- No statement generation logic here.

**CardStatementsModule (`src/card-statements/`)**
- Pure CRUD. The caller supplies `balance`, `minPayment`, `noInterestPayment`, `interestAmount` — the API does NOT calculate them.
- `CardStatementsService`: `findAllByProfile`, `findOne`, `create`, `update`, `remove`.
- `create` validates only that the `creditCardId` belongs to the profile. No date overlap check, no calculation.
- `update` allows editing any field including `isPaid`.
- No generation trigger, no link to transactions.

**TransactionsModule (`src/transactions/transactions.service.ts`)**
- `applyBalance` handles four types: `INCOME` (increment), `EXPENSE` (decrement), `TRANSFER`/`PAYMENT` (decrement source, increment destination).
- CREDIT accounts are treated as liabilities: positive balance = debt owed. An `EXPENSE` on a CREDIT account decrements balance (goes more negative = more debt).
- `validateDestinationType`: `PAYMENT` destination MUST be `CREDIT` or `LOAN`.
- **No over-limit check**: an EXPENSE on a CREDIT account can push the balance past `-creditLimit` with no validation. The service never reads `CreditCard` during transaction creation.
- **No per-transaction MSI/MSCI**: no model for interest-free months per purchase.
- **No statement link**: transactions carry no `statementId`.

**DashboardModule (`src/dashboard/dashboard.service.ts`)**
- `computeCreditOverview` fetches each card with its latest statement (`take: 1, orderBy: periodEnd desc`).
- `used` = latest statement `balance` if present, else `abs(account.balance)`.
- `available = max(0, creditLimit - used)` — computed here, NOT stored.
- `nextPaymentDue` = latest statement `periodEnd` if unpaid, else `null`. This is the period end, not the actual payment due date (which should be N days after cut).
- `minPayment` from latest statement or `null`.
- No `noInterestPayment`, no `interestAmount` exposed in the dashboard summary.

**BanksModule (`src/banks/banks.service.ts`)**
- `findCreditCardsByBank` returns credit cards under a bank with `accountName`, `balance` flattened in. No computed fields.

### Planning intent (`savy-planning.md`)

- CreditCard reactive behavior is Priority 4 on the roadmap, status **Pending**.
- Planned behaviors:
  - **Purchase** → `EXPENSE` on card account (already works via TransactionsModule).
  - **Cut date reached** → system generates a `CardStatement` with calculated `minPayment`, `noInterestPayment`, `interestAmount`. NOT implemented.
  - **Payment** → `PAYMENT` to card account (already works).
- Lazy strategy is the chosen approach: on app open, calculate what should have been generated since last check and create it then. No cron.
- The planning doc does NOT mention: MSI per transaction, MSCI, commissions, over-limit validation, saldo a favor, partial payment application order, or payment-due-date as N days after cut.

## Affected Areas

- `prisma/schema.prisma` — CreditCard and CardStatement models need new fields; Transaction may need `statementId` FK and MSI/MSCI fields.
- `src/credit-cards/credit-cards.service.ts` — needs computed `availableCredit`, possibly payment-due-date calculation, and the statement generation entry point.
- `src/credit-cards/dto/credit-card.dto.ts` — response DTO needs `availableCredit`, `currentBalance`, `nextPaymentDueDate`.
- `src/card-statements/card-statements.service.ts` — needs calculation logic for `minPayment`, `noInterestPayment`, `interestAmount`; needs generation trigger; needs transaction linkage.
- `src/card-statements/dto/card-statement.dto.ts` — may need `paymentDueDate`, `paidAmount`, `remainingBalance`, transaction list.
- `src/transactions/transactions.service.ts` — needs over-limit validation for CREDIT EXPENSE; needs statement link on creation; needs MSI/MSCI awareness.
- `src/transactions/dto/transaction.dto.ts` — needs `msiMonths?`, `statementId?` fields.
- `src/dashboard/dashboard.service.ts` — `computeCreditOverview` needs `paymentDueDate` (not periodEnd), `noInterestPayment`, `interestAmount`.
- `src/dashboard/dto/dashboard.dto.ts` — `CreditCardSummary` interface needs new fields.
- `src/banks/banks.service.ts` — `findCreditCardsByBank` may need computed `availableCredit`.

## Approaches

> Per the exploration brief: documenting options, NOT proposing solutions. The proposal phase will choose.

1. **Statement-transaction FK link** — add `statementId String?` to `Transaction` referencing `CardStatement`.
   - Pros: explicit membership; fast statement detail query; no date-range ambiguity.
   - Cons: requires backfill or null-on-existing transactions; statement generation must update transactions in a batch.
   - Effort: Medium

2. **Date-range query for statement membership** — keep no FK; derive statement transactions by `accountId + date BETWEEN periodStart AND periodEnd`.
   - Pros: zero schema change for the link; statements remain a pure read model.
   - Cons: ambiguous at period boundaries; cannot handle re-statement or corrected periods; slower for large transaction sets.
   - Effort: Low

3. **Per-transaction MSI model** — add `msiMonths Int?` and `msiStartDate` to `Transaction`; interest-free months tracked per purchase.
   - Pros: accurate promotional interest calculation per purchase; matches real card behavior.
   - Cons: interest calculation becomes per-transaction iterative; more complex statement generation.
   - Effort: High

4. **Payment-due-date as derived field** — replace fixed `paymentDay` with `paymentDueDaysAfterCut Int` and compute the due date per period.
   - Pros: handles months where paymentDay > 28 or doesn't exist; matches real card contracts.
   - Cons: breaking change to CreditCard schema; existing data needs migration.
   - Effort: Medium

5. **Commissions as transactions** — model annual fee, late payment, cash advance as `EXPENSE` transactions with a dedicated category or a `commissionType` enum.
   - Pros: reuses existing transaction + balance flow; appears in statements naturally.
   - Cons: need a commission taxonomy; cash advance has different interest rules than purchases.
   - Effort: Medium

6. **Lazy statement generation on read** — when dashboard or card-statements endpoint is hit, check if a statement should exist for the current/past period and generate it.
   - Pros: matches the lazy strategy already chosen for income/loans; no cron needed; works on Render free tier.
   - Cons: first read after cut date is slower; need idempotency guard against double generation; must handle "catch-up" for multiple missed periods.
   - Effort: Medium

## Recommendation

Documented for the proposal phase. The exploration brief explicitly asked NOT to propose solutions.

## Risks

- **Breaking schema change**: modifying `CreditCard` or `CardStatement` requires a Prisma migration on a live Supabase database. Existing rows have no `paymentDueDate`, no `paidAmount`, etc. Migration strategy must handle defaults and backfill.
- **Statement-transaction link ambiguity**: choosing FK vs date-range is a one-way architectural decision. Reversing it later is expensive.
- **Interest calculation accuracy**: Mexican credit card law (Ley para la Protección y Defensa del Usuario de Servicios Financieros) and CONDUSEF rules specify how interest is calculated (average daily balance method). Implementing a simplified version may produce numbers that don't match the bank's statement, which erodes user trust.
- **Over-limit validation scope**: adding it to `TransactionsService.create` means the service must now load `CreditCard` for every CREDIT-account EXPENSE, adding a query. Performance vs correctness tradeoff.
- **Dashboard coupling**: `computeCreditOverview` currently uses `periodEnd` as `nextPaymentDue`. Fixing this changes the dashboard contract with the frontend.
- **No `updatedAt` on CardStatement**: if statements become mutable (partial payments, corrections), the absence of `updatedAt` will cause auditability issues.

## Ready for Proposal

Yes — the orchestrator should tell the user:
- The exploration mapped what exists (CRUD-only, no calculation, no generation) vs what's missing (statement generation, interest calc, MSI/MSCI, commissions, over-limit, payment-due-date, saldo a favor, partial payment ordering).
- The proposal phase should prioritize: (1) statement generation trigger + calculation, (2) payment-due-date model, (3) statement-transaction link decision, (4) over-limit validation. MSI/MSCI and commissions can be phased later.
- A decision is needed on whether interest calculation should follow CONDUSEF average-daily-balance or a simplified method.

## Key Learnings

1. CardStatementsService is pure CRUD — the caller supplies minPayment and interestAmount; the API calculates nothing.
2. TransactionsService has no over-limit validation for CREDIT accounts; an EXPENSE can push balance past negative creditLimit silently.
3. Dashboard uses statement periodEnd as nextPaymentDue, which is the period end date, not the actual payment due date.
4. CreditCard.noInterestMonths is a card-level promotional field, not per-transaction MSI; there is no model for meses sin intereses on individual purchases.
5. CardStatement has no updatedAt field, which blocks auditability if statements become mutable for partial payments or corrections.