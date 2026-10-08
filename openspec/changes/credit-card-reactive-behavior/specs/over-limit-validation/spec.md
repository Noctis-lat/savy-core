# Over-Limit Validation Specification

## Purpose

Defines the validation that rejects `EXPENSE` transactions on `CREDIT` accounts when the resulting balance would exceed the credit limit. This prevents users from spending past their credit line without explicit awareness, matching real credit card behavior where transactions are declined at the point of sale.

## Requirements

### Requirement: Over-Limit Rejection

The system SHALL reject an `EXPENSE` transaction on a `CREDIT` account when `account.balance + amount > creditLimit + tolerance`. The rejection MUST produce a `BadRequestException` with a clear, user-facing message indicating the transaction exceeds the available credit.

#### Scenario: Transaction within limit is accepted

- GIVEN a CREDIT account with `balance = 3000.00`, `creditLimit = 10000.00`, and `tolerance = 0`
- WHEN an `EXPENSE` of `5000.00` is created
- THEN the transaction is accepted
- AND `account.balance` becomes `8000.00`

#### Scenario: Transaction exactly at limit is accepted

- GIVEN a CREDIT account with `balance = 3000.00`, `creditLimit = 10000.00`, and `tolerance = 0`
- WHEN an `EXPENSE` of `7000.00` is created
- THEN the transaction is accepted (balance + amount = limit exactly)
- AND `account.balance` becomes `10000.00`

#### Scenario: Transaction exceeding limit is rejected

- GIVEN a CREDIT account with `balance = 3000.00`, `creditLimit = 10000.00`, and `tolerance = 0`
- WHEN an `EXPENSE` of `8000.00` is created
- THEN the transaction is rejected with `BadRequestException`
- AND the error message states the transaction exceeds available credit
- AND `account.balance` remains `3000.00`

#### Scenario: Transaction exceeding limit with tolerance is rejected

- GIVEN a CREDIT account with `balance = 9500.00`, `creditLimit = 10000.00`, and `tolerance = 100.00`
- WHEN an `EXPENSE` of `700.00` is created
- THEN `balance + amount = 9500.00 + 700.00 = 10200.00 > 10000.00 + 100.00 = 10100.00`
- AND the transaction is rejected with `BadRequestException`

#### Scenario: Transaction within tolerance is accepted

- GIVEN a CREDIT account with `balance = 9500.00`, `creditLimit = 10000.00`, and `tolerance = 1000.00`
- WHEN an `EXPENSE` of `700.00` is created
- THEN `balance + amount = 10200.00 <= 10000.00 + 1000.00 = 11000.00`
- AND the transaction is accepted
- AND `account.balance` becomes `10200.00`

### Requirement: Validation Scope — CREDIT Accounts Only

The system SHALL apply over-limit validation ONLY to `EXPENSE` transactions on accounts with `type = CREDIT`. The validation MUST NOT apply to `DEBIT`, `CASH`, or `LOAN` accounts. The validation MUST NOT apply to `INCOME`, `TRANSFER`, or `PAYMENT` transaction types.

#### Scenario: EXPENSE on DEBIT account bypasses validation

- GIVEN a DEBIT account with `balance = 100.00` and no credit limit
- WHEN an `EXPENSE` of `5000.00` is created
- THEN the transaction is accepted (over-limit validation does not apply)
- AND `account.balance` becomes `-4900.00`

#### Scenario: PAYMENT on CREDIT account bypasses validation

- GIVEN a CREDIT account with `balance = 9000.00` and `creditLimit = 10000.00`
- WHEN a `PAYMENT` of `5000.00` is created (reducing balance)
- THEN the transaction is accepted (over-limit validation does not apply to PAYMENT)
- AND `account.balance` becomes `4000.00`

#### Scenario: TRANSFER from CREDIT account bypasses validation

- GIVEN a CREDIT account with `balance = 9000.00` and `creditLimit = 10000.00`
- WHEN a `TRANSFER` of `2000.00` is created from the CREDIT account
- THEN the transaction is accepted (over-limit validation does not apply to TRANSFER)

### Requirement: Feature Flag Gating

The system SHALL gate over-limit validation behind the `CREDIT_CARD_REACTIVE_ENABLED` feature flag. When the flag is `false`, the system MUST skip the over-limit check entirely, preserving the current CRUD-only behavior.

#### Scenario: Validation skipped when flag is disabled

- GIVEN `CREDIT_CARD_REACTIVE_ENABLED = false`, a CREDIT account with `balance = 9000.00` and `creditLimit = 10000.00`
- WHEN an `EXPENSE` of `5000.00` is created
- THEN the transaction is accepted (no over-limit check)
- AND `account.balance` becomes `14000.00` (exceeds limit)

#### Scenario: Validation active when flag is enabled

- GIVEN `CREDIT_CARD_REACTIVE_ENABLED = true`, a CREDIT account with `balance = 9000.00` and `creditLimit = 10000.00`
- WHEN an `EXPENSE` of `5000.00` is created
- THEN the transaction is rejected with `BadRequestException`

### Requirement: Tolerance Configuration

The system SHALL support a configurable tolerance value that allows transactions to exceed the credit limit by a small amount. The tolerance default SHALL be `0.00`. The tolerance MAY be configured per card or globally.

#### Scenario: Default tolerance is zero

- GIVEN a CREDIT account with no explicit tolerance configured
- WHEN the system checks the over-limit condition
- THEN the tolerance is `0.00`
- AND any amount exceeding the exact limit is rejected

#### Scenario: Custom tolerance allows small overage

- GIVEN a CREDIT account with `tolerance = 500.00`, `balance = 9800.00`, and `creditLimit = 10000.00`
- WHEN an `EXPENSE` of `400.00` is created
- THEN `9800.00 + 400.00 = 10200.00 <= 10000.00 + 500.00 = 10500.00`
- AND the transaction is accepted

### Requirement: Saldo a Favor Allows Overpayment Spending

The system SHALL allow `EXPENSE` transactions that consume a saldo a favor (negative balance) without triggering over-limit rejection, as long as the resulting balance does not exceed `creditLimit + tolerance`.

#### Scenario: Spending from saldo a favor

- GIVEN a CREDIT account with `balance = -1000.00` (saldo a favor), `creditLimit = 10000.00`, and `tolerance = 0`
- WHEN an `EXPENSE` of `5000.00` is created
- THEN `balance + amount = -1000.00 + 5000.00 = 4000.00 <= 10000.00`
- AND the transaction is accepted
- AND `account.balance` becomes `4000.00`

#### Scenario: Saldo a favor with large purchase within limit

- GIVEN a CREDIT account with `balance = -500.00` (saldo a favor), `creditLimit = 10000.00`
- WHEN an `EXPENSE` of `10000.00` is created
- THEN `balance + amount = -500.00 + 10000.00 = 9500.00 <= 10000.00`
- AND the transaction is accepted