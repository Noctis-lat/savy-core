# Commissions Specification

## Purpose

Defines the modeling of credit card commissions as typed `EXPENSE` transactions with a `commissionType` discriminator. This approach reuses the existing `Transaction` balance flow without introducing a separate entity. Commission types include annual fee, late payment, and cash advance.

## Requirements

### Requirement: Commission Type Discriminator

The system SHALL model commissions as `EXPENSE` transactions with a `commissionType` field on the `Transaction` model. The `commissionType` field SHALL accept values from the `CommissionType` enum: `ANNUAL_FEE`, `LATE_PAYMENT`, `CASH_ADVANCE`. Transactions without a commission type SHALL have `commissionType = null`.

#### Scenario: Annual fee commission created

- GIVEN a CREDIT account and a commission definition for an annual fee of `500.00`
- WHEN a commission `EXPENSE` transaction is created with `commissionType = ANNUAL_FEE`
- THEN the transaction is stored with `type = EXPENSE`, `commissionType = ANNUAL_FEE`, and `amount = 500.00`
- AND `account.balance` increases by `500.00` (standard EXPENSE behavior)

#### Scenario: Late payment commission created

- GIVEN a CREDIT account with an unpaid past-due statement
- WHEN a late payment commission `EXPENSE` is created with `commissionType = LATE_PAYMENT`
- THEN the transaction is stored with `type = EXPENSE` and `commissionType = LATE_PAYMENT`
- AND `account.balance` increases by the commission amount

#### Scenario: Regular expense has null commissionType

- GIVEN a CREDIT account and a standard purchase
- WHEN an `EXPENSE` transaction is created without a commission type
- THEN the transaction is stored with `commissionType = null`
- AND the transaction is treated as a regular purchase

### Requirement: Commission Balance Flow

Commissions SHALL follow the standard `EXPENSE` balance flow: the transaction increments `account.balance` on the CREDIT account. The system MUST NOT implement a separate balance pathway for commissions. Commissions are subject to the same over-limit validation as regular expenses.

#### Scenario: Commission increments balance

- GIVEN a CREDIT account with `balance = 2000.00` and `creditLimit = 10000.00`
- WHEN an annual fee commission of `500.00` is created
- THEN `account.balance` becomes `2500.00`
- AND `availableCredit` becomes `7500.00`

#### Scenario: Commission rejected if over-limit

- GIVEN a CREDIT account with `balance = 9800.00`, `creditLimit = 10000.00`, and `tolerance = 0`
- WHEN a late payment commission of `300.00` is created
- THEN the transaction is rejected with `BadRequestException` (over-limit validation applies)

### Requirement: Commission Inclusion in Statement

Commissions created during a statement period SHALL be included in the statement balance at generation time. Commissions SHALL be included in the payment waterfall after interest and before the ordinary balance.

#### Scenario: Commission included in statement balance

- GIVEN a CREDIT account with a `LATE_PAYMENT` commission of `200.00` during the statement period
- WHEN the statement is generated
- THEN the commission amount is included in the statement `balance`
- AND the commission is linked to the statement via `statementId`

#### Scenario: Commission in payment waterfall

- GIVEN a statement with `interestAmount = 300.00`, commissions totaling `200.00`, and ordinary balance `2000.00`
- WHEN a payment of `600.00` is applied
- THEN `300.00` is applied to interest first
- THEN `200.00` is applied to commissions second
- THEN `100.00` is applied to ordinary balance
- AND the payment waterfall order is: interest → commissions → ordinary → MSI → MSCI

> **ASSUMPTION — TODO: Verify payment waterfall order against primary Banxico/CONDUSEF source.**
> The payment application order (interest → commissions → ordinary → MSI → MSCI) is an assumption not confirmed from primary sources. See the statement-generation spec for the full waterfall assumption documentation.

### Requirement: Cash Advance Commission (Reserved, Not Implemented)

The `CASH_ADVANCE` commission type SHALL be reserved in the enum for future use. The system MUST accept and store `CASH_ADVANCE` transactions, but the specific cash advance logic (immediate interest accrual, ATM fee calculation) is explicitly out of scope for this change.

#### Scenario: Cash advance stored as commission

- GIVEN a CREDIT account
- WHEN a `CASH_ADVANCE` commission `EXPENSE` is created with `amount = 1000.00`
- THEN the transaction is stored with `commissionType = CASH_ADVANCE`
- AND `account.balance` increases by `1000.00`
- AND no special immediate-interest logic is applied (deferred to a future change)

#### Scenario: Cash advance subject to over-limit validation

- GIVEN a CREDIT account with `balance = 9000.00` and `creditLimit = 10000.00`
- WHEN a `CASH_ADVANCE` commission of `2000.00` is created
- THEN the transaction is rejected with `BadRequestException` (over-limit validation applies, same as any EXPENSE)

### Requirement: Commission Tax (IVA)

Commissions SHALL be subject to IVA at 16%. The commission amount stored on the `Transaction` SHALL be the IVA-inclusive total. The system MAY store the pre-IVA amount in a separate field for reporting purposes.

#### Scenario: Commission with IVA included

- GIVEN an annual fee of `431.03` (pre-IVA)
- WHEN the commission transaction is created
- THEN the stored `amount = 500.00` (IVA-inclusive: `431.03 × 1.16 = 500.00`)
- AND `account.balance` increases by `500.00`

#### Scenario: Commission IVA in payment waterfall

- GIVEN a commission of `500.00` (IVA-inclusive) in the payment waterfall
- WHEN a payment is applied to the statement
- THEN the full `500.00` is part of the commissions category in the waterfall
- AND no separate IVA calculation is needed at payment time (IVA was already included)

### Requirement: Commission Not Auto-Generated

The system SHALL NOT automatically generate commission transactions as part of statement generation. Commissions are created by explicit user action or by a future scheduling system. The spec defines the model and balance flow only.

#### Scenario: No automatic annual fee on statement generation

- GIVEN a CREDIT account with an annual fee due
- WHEN a statement is generated
- THEN no `ANNUAL_FEE` commission transaction is created automatically
- AND the annual fee must be recorded by the user or a future scheduled job

#### Scenario: Late payment commission created manually

- GIVEN a CREDIT account with a past-due statement
- WHEN the user (or an admin) creates a `LATE_PAYMENT` commission transaction
- THEN the transaction is stored and linked to the current statement period
- AND the commission appears in the next generated statement if within the period