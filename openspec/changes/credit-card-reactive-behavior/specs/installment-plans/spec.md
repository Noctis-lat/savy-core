# Installment Plans Specification

## Purpose

Defines per-transaction installment plan tracking for MSI (Meses Sin Intereses) and MSCI (Meses Con Intereses) promotions. Each installment plan is tied to a single `Transaction` and tracks the lifecycle from creation through completion or cancellation. The current month's mensualidad is included in each statement's balance and PNGI calculation.

## Requirements

### Requirement: InstallmentPlan Entity

The system SHALL create an `InstallmentPlan` entity for each transaction that has an installment promotion. The entity MUST track: `transactionId` (FK to the source transaction), `type` (MSI or MSCI), `totalMonths`, `currentMonth`, `monthlyAmount`, `interestRate` (null for MSI, non-null for MSCI), `status` (ACTIVE, COMPLETED, CANCELLED), `createdAt`, and `updatedAt`.

#### Scenario: MSI plan created on transaction

- GIVEN a `Transaction` of `6000.00` on a CREDIT account with `msiMonths = 12` and `msiType = MSI`
- WHEN the transaction is created
- THEN an `InstallmentPlan` is created with `type = MSI`, `totalMonths = 12`, `currentMonth = 0`, `monthlyAmount = 500.00`, `interestRate = null`, `status = ACTIVE`

#### Scenario: MSCI plan created on transaction

- GIVEN a `Transaction` of `6000.00` on a CREDIT account with `msiMonths = 12`, `msiType = MSCI`, and a promotional rate of `0.1200` (12%)
- WHEN the transaction is created
- THEN an `InstallmentPlan` is created with `type = MSCI`, `totalMonths = 12`, `currentMonth = 0`, `monthlyAmount` calculated per the MSCI amortization rule, `interestRate = 0.1200`, `status = ACTIVE`

#### Scenario: No plan created when msiMonths is absent

- GIVEN a `Transaction` with no `msiMonths` field
- WHEN the transaction is created
- THEN no `InstallmentPlan` is created

### Requirement: MSI Mechanics — Immediate Credit Consumption

For MSI plans, the full purchase amount SHALL consume available credit immediately via `account.balance` (this is the existing behavior — the transaction already increments balance). The monthly mensualidad appears in each subsequent statement's balance and PNGI but does NOT generate additional balance changes.

#### Scenario: Full amount consumed immediately

- GIVEN a credit card with `creditLimit = 10000.00` and `account.balance = 0.00`
- WHEN an MSI purchase of `6000.00` with `msiMonths = 12` is created
- THEN `account.balance` becomes `6000.00`
- AND `availableCredit` becomes `4000.00`
- AND the `InstallmentPlan` has `monthlyAmount = 500.00`

#### Scenario: Mensualidad in statement balance

- GIVEN an active MSI plan with `monthlyAmount = 500.00` and `currentMonth = 3`
- WHEN a statement is generated for the current period
- THEN the mensualidad of `500.00` is included in the statement's `balance`
- AND the same `500.00` is included in the PNGI calculation as the current mensualidad

### Requirement: MSI Unpaid Mensualidad Generates Interest

If an MSI mensualidad is not paid by the due date, the system SHALL treat it as revolving balance for interest calculation purposes in the next period. The unpaid mensualidad MUST be included in the average daily balance.

#### Scenario: Unpaid mensualidad accrues interest

- GIVEN an MSI plan with `monthlyAmount = 500.00`, the statement due date has passed, and `paidAmount < mensualidad`
- WHEN the next period statement is generated
- THEN the unpaid `500.00` is included in the revolving balance
- AND interest is calculated on it per the average daily balance method

### Requirement: MSCI Ammonrtization (Simplified v1)

For MSCI plans, the system SHALL calculate the monthly interest using a simplified method: `monthlyInterest = principal × interestRate / totalMonths`. The `monthlyAmount` is `principal / totalMonths + monthlyInterest`.

> **ASSUMPTION — TODO: Verify exact MSCI amortization method against primary sources.**
> The exact amortization method for MSCI (meses con intereses) is under-documented in primary Banxico/CONDUSEF sources consulted during research. The simplified method (simple interest divided by months) is a known approximation. The design phase MUST document this assumption and the user SHOULD accept it before implementation. A TODO marker MUST be placed in the code for precision refinement in a future change.

#### Scenario: MSCI monthly amount calculation

- GIVEN a principal of `6000.00`, an interest rate of `0.1200` (12%), and `totalMonths = 12`
- WHEN the monthly amount is calculated
- THEN `monthlyInterest = 6000.00 × 0.1200 / 12 = 60.00`
- AND `monthlyAmount = 6000.00 / 12 + 60.00 = 500.00 + 60.00 = 560.00`

#### Scenario: MSCI interest is per-plan, not revolving

- GIVEN an active MSCI plan with `interestRate = 0.1200`
- WHEN interest is calculated for the period
- THEN the MSCI plan's interest is determined by the plan's rate, NOT the card's revolving `interestRate`
- AND the MSCI plan balance is excluded from the revolving average daily balance

### Requirement: Installment Plan Lifecycle

The system SHALL manage the installment plan lifecycle through three states: ACTIVE, COMPLETED, and CANCELLED. An ACTIVE plan advances `currentMonth` by 1 at each statement generation. When `currentMonth` reaches `totalMonths`, the status transitions to COMPLETED.

#### Scenario: Plan advances on statement generation

- GIVEN an active MSI plan with `currentMonth = 2` and `totalMonths = 12`
- WHEN a new statement is generated
- THEN `currentMonth` is incremented to `3`
- AND `status` remains `ACTIVE`

#### Scenario: Plan completes at final month

- GIVEN an active MSI plan with `currentMonth = 11` and `totalMonths = 12`
- WHEN a new statement is generated
- THEN `currentMonth` is incremented to `12`
- AND `status` transitions to `COMPLETED`
- AND no further mensualidad is included in subsequent statements

#### Scenario: Completed plan excluded from statement

- GIVEN a completed MSI plan (status = COMPLETED)
- WHEN a new statement is generated
- THEN the plan's mensualidad is NOT included in the statement balance
- AND the plan is NOT included in the PNGI calculation

### Requirement: Plan Cancellation

The system MAY support cancellation of an active installment plan. Upon cancellation, the `status` transitions to `CANCELLED` and the remaining balance becomes revolving debt subject to the card's standard interest rate.

> **Note**: Card cancellation mid-MSI-plan is explicitly out of scope per the proposal. This requirement covers user-initiated plan cancellation, which is a future capability. The spec defines the state transition but defers the cancellation flow.

#### Scenario: Cancelled plan remaining balance becomes revolving

- GIVEN an active MSI plan with `totalMonths = 12`, `currentMonth = 4`, and remaining balance `4000.00`
- WHEN the plan is cancelled
- THEN `status` transitions to `CANCELLED`
- AND the remaining `4000.00` is treated as revolving balance for future interest calculations
- AND no further mensualidad is tracked

### Requirement: Current Month Mensualidad in Statement

At statement generation, the system SHALL include the current month's mensualidad from all ACTIVE installment plans in the statement's balance and PNGI. The system MUST advance `currentMonth` as part of the generation process.

#### Scenario: Multiple active plans contribute to statement

- GIVEN an MSI plan with `monthlyAmount = 500.00` (currentMonth = 3) and an MSCI plan with `monthlyAmount = 560.00` (currentMonth = 2)
- WHEN a statement is generated
- THEN the statement balance includes `500.00 + 560.00 = 1060.00` from mensualidades
- AND the PNGI includes both mensualidades
- AND both plans' `currentMonth` is incremented

#### Scenario: Plan that completes this period

- GIVEN an MSI plan with `monthlyAmount = 500.00`, `currentMonth = 11`, `totalMonths = 12`
- WHEN a statement is generated
- THEN the mensualidad of `500.00` is included in this statement
- AND `currentMonth` becomes `12` and `status` becomes `COMPLETED`
- AND subsequent statements do NOT include this plan's mensualidad

### Requirement: Installment Transaction per Cut

At each statement generation, the system SHALL create one `INSTALLMENT` transaction for every ACTIVE plan whose purchase date is on or before the period end, BEFORE advancing the plan. The row MUST have `accountId` = card account, `statementId` = the new statement, `date` = period end (cut day), `installmentPlanId` = plan id, `installmentNumber` = `currentMonth + 1`, `amount` = `monthlyAmount`, `categoryId` = null and `description` = `"<purchase description> (n/N)"` (fallback `"Installment purchase (n/N)"`). Period queries of the generator (period transactions, later-transactions rollback, average daily balance) MUST exclude `INSTALLMENT` rows.

#### Scenario: MSI 3-month lifecycle

- GIVEN an MSI purchase "Laptop" of `3000.00` in 3 months, dated inside the first period
- WHEN three consecutive statements are generated
- THEN statements 1, 2 and 3 contain `Laptop (1/3)`, `Laptop (2/3)` and `Laptop (3/3)` of `1000.00` each, dated on their cut day
- AND the plan becomes COMPLETED and the 4th statement contains no installment row

#### Scenario: Plan purchased after the period

- GIVEN an MSI purchase dated after the period end
- WHEN the statement for that period is generated
- THEN no installment row is created for it

### Requirement: No Balance Effect for MSI Installments

`INSTALLMENT` rows of MSI plans MUST NOT change `account.balance`; the full purchase already counted as debt. The frozen statement balance, PNGI and minimum payment MUST be identical with or without the installment rows.

#### Scenario: Balance and statement unchanged

- GIVEN an MSI plan of `3000.00` in 3 months and a card balance of `3000.00`
- WHEN the first statement is generated
- THEN the card balance stays `3000.00`, the statement balance is `3000.00` and PNGI is `1000.00`

### Requirement: MSCI Interest Component

For MSCI plans, the system SHALL increment `account.balance` by the interest component of the installment, `monthlyAmount − purchase / totalMonths`, rounded to 2 decimals (never negative). Like `INTEREST_CHARGE`, it is applied AFTER the statement balance is frozen: it is NOT part of that statement's `balance`, it is billed in that statement through PNGI (the current mensualidad includes it) and it carries into the next period's opening balance. The detail response exposes the principal/interest split instead of a separate row.

#### Scenario: Interest becomes debt at the cut

- GIVEN an MSCI purchase of `6000.00` in 12 months with `monthlyAmount = 560.00`
- WHEN the first statement is generated
- THEN the card balance becomes `6060.00`, the statement balance is `6000.00` and PNGI is `560.00`

#### Scenario: No double counting next period

- GIVEN the previous scenario and a payment of `560.00` before the next cut
- WHEN the second statement is generated
- THEN its balance is `5500.00` and PNGI is `560.00` (5500 − 5500 remaining principal + 560)

### Requirement: Early Payoff (PAID_OFF)

When a `PAYMENT` to a CREDIT account leaves its balance at `<= 0` (flag on), the system SHALL mark every ACTIVE plan whose purchase belongs to that account as `PAID_OFF`. PAID_OFF plans generate no further installment rows and are excluded from PNGI. Deleting or editing that payment later does NOT reopen the plans (known limitation).

#### Scenario: Full payoff

- GIVEN a card with balance `3000.00` and an ACTIVE MSI plan
- WHEN a PAYMENT of `3000.00` is created
- THEN the plan status becomes `PAID_OFF`

#### Scenario: Partial payment

- GIVEN a card with balance `3000.00` and an ACTIVE MSI plan
- WHEN a PAYMENT of `2999.99` is created
- THEN the plan stays `ACTIVE`

#### Scenario: Flag off

- GIVEN `CREDIT_CARD_REACTIVE_ENABLED` is not `true`
- WHEN a PAYMENT clears the card
- THEN plans are not modified

### Requirement: INSTALLMENT is System-Only

`INSTALLMENT` transactions SHALL only be created by the statement engine. Create/Update transaction DTOs MUST reject `type = INSTALLMENT` (400) and update/delete of an `INSTALLMENT` transaction MUST be rejected (400). Aggregations (income vs expenses, budgets spent, top categories, dashboard recent activity) MUST NOT count them; the original purchase counts once, in the month it was made. List endpoints MAY show them and MAY filter by them.

#### Scenario: Reject user-created installment

- WHEN a client POSTs a transaction with `type = INSTALLMENT`
- THEN the API responds 400

#### Scenario: Reject edits and deletes

- GIVEN an INSTALLMENT transaction
- WHEN the client PATCHes or DELETEs it
- THEN the API responds 400 and the balance is unchanged

### Requirement: Statement Detail Response

`GET /api/card-statements/:id/transactions` SHALL return INSTALLMENT rows first (by installment number, then date) followed by the other rows by date and creation time. Each INSTALLMENT row includes `installment` = { `number`, `totalInstallments`, `billedInstallments`, `paidInstallments` (rows whose statement `isPaid`; all if PAID_OFF), `remainingInstallments`, `monthlyAmount`, `principalAmount`, `interestAmount`, `remainingAmount` (purchase × remaining / total), `type`, `status`, `purchase` { `id`, `description`, `amount`, `date` } }. Money values are strings with 2 decimals. Other rows have `installment: null`. Plans are loaded in one batch query.

#### Scenario: Installments first with summary

- GIVEN a statement with an EXPENSE, a PAYMENT and installments `TV (5/12)` and `Laptop (2/3)`
- WHEN the detail is requested
- THEN the order is `Laptop (2/3)`, `TV (5/12)`, EXPENSE, PAYMENT
- AND `Laptop (2/3)` reports 2 billed, 1 paid, 2 remaining and `remainingAmount = "2000.00"`

#### Scenario: PAID_OFF plan

- GIVEN an installment of a PAID_OFF plan
- WHEN the detail is requested
- THEN `paidInstallments = totalInstallments`, `remainingInstallments = 0` and `remainingAmount = "0.00"`

