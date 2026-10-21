# Savy — Project Planning

Central planning document for the Savy personal finance API. All product decisions, entity relationships, behaviors, and roadmap live here. Read this before building or modifying any feature.

> This document evolves across sessions. Each section may be incomplete — check the status markers.

---

## 1. Entities & Relationships

### Entity Map

```
Profile (root)
├── Bank[]
│   └── Account[]              ← bank groups accounts; cash accounts have bankId = null
│       ├── CreditCard? (1:1)  ← extension: credit-specific fields
│       │   └── CardStatement[]
│       ├── Loan? (1:1)        ← extension: loan-specific fields
│       ├── Transaction[]      ← origin or destination
│       ├── SavingsGoal[]      ← progress derived from account balance
│       ├── IncomeSource[]     ← periodic income targets this account
│       └── RecurringExpense[] ← periodic expenses charged to this account
├── Account[]                  ← direct relation (for bankless accounts: CASH)
├── Category[]                 ← classify transactions and budgets (INCOME | EXPENSE)
├── Budget[]                   ← informational plans over categories (items), recurring or one-time
├── SavingsGoal[]              ← savings targets linked to an account
├── IncomeSource[]             ← recurring income definitions
└── RecurringExpense[]         ← recurring expense definitions (subscriptions, services, etc.)
```

### Entity Descriptions

**Profile**
The app user. Linked to Supabase Auth via `authId` (JWT `sub` claim). Stores personal info (name, avatar, phone) and preferences (currency, locale, timezone). Root owner of all other entities.

**Bank**
Financial institution that groups accounts (BBVA, Citi, Nu, etc.). Has name, color, and logo. Cash accounts don't belong to a bank (`bankId = null`). Soft delete with `isActive`.

**Account**
Central entity of the system. Every financial interaction flows through an account. Types: `DEBIT`, `CREDIT`, `LOAN`, `CASH`. Belongs to a Profile and optionally to a Bank. Holds balance, currency, color, and icon. CreditCard and Loan are 1:1 extensions that add domain-specific rules — the money still moves through the account.

**Transaction**
A money movement. Types: `INCOME`, `EXPENSE`, `TRANSFER`, `PAYMENT`. Points to an origin account (`accountId`) and optionally a destination account (for transfers/payments). Can reference a Category. Has description, note, and date.

**Category**
User-defined label for classifying transactions. Type: `INCOME` or `EXPENSE`. Unique per profile+name+type. Has color and icon. Used by Transaction and Budget.

**Budget**
Informational, category-based plan (it never blocks transactions and is not tied to accounts). Has a `name` and a `kind`:
- `RECURRING` — repeats every `period` (`WEEKLY`, `BIWEEKLY`, `MONTHLY`, `YEARLY`) from `startDate`, with optional `endDate`.
- `ONE_TIME` — a single range from `startDate` to a required `endDate`; `period` is null.

A budget holds multiple **BudgetItem**s (`categoryId`, `amount`, unique per budget+category). Items can use `INCOME` or `EXPENSE` categories. Progress is computed per item for the current period from the transactions of that category (INCOME items sum incomes; EXPENSE items sum expenses, counting MSI/MSCI purchases by their billed installments), and rolled up into `totalPlanned` / `totalSpent` / `totalRemaining` / `totalPercentage`. When a recurring period ends, a **BudgetPeriodSnapshot** (with **BudgetItemSnapshot**s) is created lazily on read to freeze the history. Soft delete with `isActive`.

**SavingsGoal**
Savings target linked to a specific account. Stores target amount (`targetAmount`), optional deadline, and color. Progress is derived from the account balance — not stored separately. When a transaction affects the linked account, the goal progress updates automatically.

**IncomeSource**
Recurring income definition. Stores amount, frequency (`WEEKLY`, `BIWEEKLY`, `MONTHLY`), paydays (`Int[]`), destination account, optional `INCOME` category, and a `lastGeneratedAt` cursor. The system generates `INCOME` transactions (linked via `Transaction.incomeSourceId`) to the destination account when paydays are reached.

**RecurringExpense**
Recurring expense definition — the expense mirror of `IncomeSource`. Covers subscriptions (Netflix, Spotify), services (electricity, internet, rent), and any periodic expense. Distinguished by `type` enum: `SUBSCRIPTION`, `SERVICE`, `UNCLASSIFIED`. Stores amount, frequency (`WEEKLY`, `BIWEEKLY`, `MONTHLY`, `YEARLY`), billing days (`Int[]`), payment account (`accountId`), optional category, optional URL (for subscription management), color, and icon. Soft delete with `isActive`. Two delete modes: soft (cancel, keeps history) and permanent (hard delete). The system will generate `EXPENSE` transactions on the payment account when billing days are reached (reactive behavior pending implementation).

**CreditCard**
Credit card details, 1:1 extension of an Account of type `CREDIT`. Stores credit limit, cut day, payment due offset (`paymentDueDays`, default 20 days after the cut; replaces the deprecated `paymentDay`), over-limit tolerance, annual interest rate (as decimal: `0.3600 = 36%`), and interest-free months. Generates CardStatements lazily. Responses include the computed `availableCredit` (`creditLimit - account.balance`).

**CardStatement**
Statement generated for a billing period of a CreditCard. Contains period balance, minimum payment, no-interest payment (PNGI), interest amount (IVA included), payment due date (next business day, Mexican holidays honored), payment progress (`paidAmount`, `remainingBalance`, `isPaid`), and `isGenerated`. Calculated fields are frozen at generation; only payment-progress fields change afterwards.

**InstallmentPlan**
Per-purchase installment tracking for MSI (interest-free) and MSCI (with interest). 1:1 with the purchase `Transaction`. Stores type, total months, current month, monthly amount, optional interest rate, and status (`ACTIVE`, `COMPLETED`, `CANCELLED`, `PAID_OFF`). The full purchase consumes credit immediately; the current mensualidad is included in each statement's PNGI and the plan advances one month per generated statement. Each billed installment is a system-generated `INSTALLMENT` transaction linked to its plan (`installmentPlanId`, `installmentNumber`).

**Loan**
Loan details, 1:1 extension of an Account of type `LOAN`. Stores principal, annual interest rate, term in months, start date, calculated monthly payment, and remaining balance.

---

## 2. Account as Central Entity

Account is the hub of the financial model. This is a deliberate design decision.

### Why

- **Uniform transaction interface**: `Transaction` only needs `accountId`. It doesn't care if the account is debit, credit, loan, or cash — the transaction logic is the same.
- **Extensions add rules, not flow**: `CreditCard` and `Loan` extend an Account with domain-specific fields and business rules (interest, statements, remaining balance), but money always enters and exits through the Account.
- **Query simplicity**: to get all credit cards of a bank → `Bank → Account[] → CreditCard`. No need for direct `Bank → CreditCard` relationships.

### Account behavior by type

| Type | Balance represents | Transaction effect |
|---|---|---|
| `DEBIT` | Available funds | INCOME increases, EXPENSE decreases |
| `CASH` | Cash on hand | Same as DEBIT |
| `CREDIT` | Used credit (debt) | EXPENSE increases balance (more debt), PAYMENT decreases it |
| `LOAN` | Remaining debt | PAYMENT decreases `Loan.remaining`, interest charges increase it |

---

## 3. Reactive Behaviors

Certain entities react when their linked account is affected by a transaction.

### SavingsGoal

The goal's progress is always in sync with its account balance. No separate "saved amount" field — progress = account balance vs. target amount. When the user deposits into the goal's account, progress increases automatically.

### Loan

- **Payment received** → `Transaction` of type `PAYMENT` to the loan's account → `Loan.remaining` decreases by the payment amount.
- **Interest charge** (periodic) → system generates an `EXPENSE` transaction on the loan's account → `Loan.remaining` increases by the interest amount.

### CreditCard

- **Purchase** → `Transaction EXPENSE` on the card's account → balance (used credit) increases.
- **Cut date reached** → system lazily generates a `CardStatement` (on dashboard or card-statements read) with calculated fields (minimum payment, no-interest payment, interest amount, payment due date). Missed periods are caught up in order, up to `CREDIT_CARD_MAX_CATCH_UP_PERIODS`.
- **Interest** → charged only when the previous statement was paid below its no-interest payment; average daily balance × rate / 360 × days, plus 16% IVA. The first statement carries no interest.
- **Over-limit** → `EXPENSE` on a card that would exceed `creditLimit + overLimitTolerance` is rejected.
- **MSI / MSCI purchase** → `EXPENSE` with `msiMonths`/`msiType` creates an `InstallmentPlan`.
- **Installments per cut** → at each cut, every ACTIVE plan bills one `INSTALLMENT` transaction (`"<purchase> (n/N)"`, amount = mensualidad, dated on the cut, linked to the statement). MSI rows do not change the balance (the full purchase already counted); for MSCI the interest component is added to the balance as new debt. Like the interest charge, it is applied after the statement balance is frozen and billed through PNGI. `INSTALLMENT` is system-only (not creatable, editable or deletable) and never counts as spending or income.
- **Early payoff** → a `PAYMENT` that leaves the card balance at `<= 0` marks its ACTIVE plans `PAID_OFF` (no more installments, out of PNGI). Removing that payment later does not reopen them.
- **Statement detail** → `GET /card-statements/:id/transactions` lists installments first, each with a plan summary (billed / paid / remaining installments, principal/interest split, remaining principal, purchase).
- **Payment** → `Transaction PAYMENT` to the card's account → balance decreases; the payment is also applied to the latest unpaid statement (`paidAmount`, `remainingBalance`, `isPaid`).
- **Feature flag** → all of the above writes are gated by `CREDIT_CARD_REACTIVE_ENABLED` (default `false`). `availableCredit` and `paymentDueDate` reads are never gated.

### IncomeSource

- **Payday reached** → system generates a `Transaction INCOME` to the `destinationAccountId` → account balance increases. **Implemented** as a daily cron (`IncomeGenerationModule`, 3 AM): paydays are evaluated in the profile's timezone (WEEKLY = weekday 1-7 with 1 = Monday; BIWEEKLY/MONTHLY = day of month, clamped to the month's last day), never before the source's `createdAt`. The transaction uses the source's name as description and its category. The `lastGeneratedAt` cursor only moves forward, so deleting a generated income does not recreate it.

### RecurringExpense

- **Billing day reached** → system generates a `Transaction EXPENSE` on the `accountId` → account balance decreases. *(PENDING implementation — will follow the same daily-cron strategy as IncomeSource)*

---

## 4. Architecture Decisions

### Periodic transactions strategy

**Hybrid: scheduled jobs + lazy catch-up**

The API now runs on its own always-on server, so `@nestjs/schedule` cron jobs are reliable. Income sources are generated by a daily cron (`IncomeGenerationModule`). Credit card statements and budget snapshots still use the lazy (on-read) strategy; they can move to cron jobs later using the same service methods — only the trigger changes, no data model changes required.

---

## 5. Module Roadmap

### Built ✓

| Module | Description |
|---|---|
| PrismaModule | Global DB client |
| AuthModule | Supabase auth + JWT validation + guards |
| ProfilesModule | Profile CRUD + computed fields |
| AccountsModule | Account CRUD with soft delete |
| BanksModule | Bank CRUD with soft delete |
| CategoriesModule | Category CRUD |
| TransactionsModule | Transaction CRUD |
| CreditCardsModule | Credit card CRUD |
| CardStatementsModule | Statement generation |
| LoansModule | Loan CRUD |
| BudgetsModule | Multi-category budgets (recurring / one-time) with per-period progress and snapshots |
| SavingsGoalsModule | Savings goal CRUD |
| IncomeSourcesModule | Income source CRUD + bulk create |
| IncomeGenerationModule | Hourly cron generating INCOME transactions from income sources |
| RecurringExpensesModule | Recurring expense CRUD (subscriptions, services) with soft + hard delete |
| DashboardModule | Analytics summary |

### To Build

| Priority | Feature | Dependencies | Status |
|---|---|---|---|
| 1 | RecurringExpense reactive behavior — EXPENSE transaction generation on billing day | RecurringExpensesModule, TransactionsModule | **Pending** |
| 2 | IncomeSource reactive behavior — INCOME transaction generation on payday | IncomeSourcesModule, TransactionsModule | **Implemented** (hourly cron) |
| 3 | Loan reactive behavior — interest charge + payment processing | LoansModule, TransactionsModule | Pending |
| 4 | CreditCard reactive behavior — statement generation on cut date | CreditCardsModule, CardStatementsModule | **Implemented behind `CREDIT_CARD_REACTIVE_ENABLED` (default off)** — pending manual E2E and balance-sign decision (see below) |
| 5 | SavingsGoal reactive behavior — auto progress from account balance | SavingsGoalsModule | Pending |

> **CreditCard reactive — open items**: (1) the Banxico payment waterfall order and the simplified MSCI amortization are documented assumptions (`// ASSUMPTION — TODO` in `CreditCalculationService`). (2) Sign convention: the reactive logic and specs treat a positive CREDIT `account.balance` as debt, but `TransactionsService.applyBalance` still decrements the source balance on `EXPENSE` for every account type and `prisma/seed.ts` stores CREDIT debt as a negative balance (e.g. `-8500`). Decide and align before enabling the flag in production.

> Priority order is a suggestion based on dependency chains. The actual order may change based on frontend needs.

---

## 6. Future Ideas & Backlog

- **Scheduler module** (`@nestjs/schedule`) for periodic transactions (see §4)
- **Recurring transactions** beyond income sources and recurring expenses (e.g., one-off scheduled transactions)
- **Multi-currency support** with exchange rate tracking
- **Reports & analytics** module (spending trends, category breakdowns)
- **Notifications** (budget exceeded, payment due, goal reached, subscription renewal reminder)
- **Import/export** (CSV, bank statement parsing)
- **Shared accounts** (multi-profile access to an account)
- **RecurringExpense enhancements**: trial period tracking, auto-renew flag, next billing date computation, manual payment marking

---

*Last updated: 2026-10-08 — Session: CreditCard reactive behavior implemented behind feature flag*
