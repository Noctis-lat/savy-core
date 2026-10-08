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