# Statement Generation Specification

## Purpose

Defines the lazy, on-read generation of `CardStatement` rows for credit cards. When a user opens the app (dashboard or card-statements endpoint) and a cut date has passed since the last generated statement, the system MUST create the missing frozen statement rows with calculated fields. This replaces the current CRUD-only model where the caller supplies `balance`, `minPayment`, `noInterestPayment`, and `interestAmount` manually.

## Requirements

### Requirement: Lazy Generation Trigger

The system SHALL generate missing `CardStatement` rows on read when a cut date has passed since the last generated statement. The system MUST NOT use background jobs or cron schedulers — generation is triggered exclusively by read operations on the dashboard or card-statements endpoints.

#### Scenario: First statement generation on first app open after cut date

- GIVEN a `CreditCard` with `cutDay = 15`, `paymentDueDays = 20`, and no existing `CardStatement` rows
- WHEN the user opens the app on October 16, 2026 and the dashboard or card-statements endpoint is called
- THEN the system generates one `CardStatement` for the period September 15 – October 15
- AND the statement contains calculated `balance`, `minPayment`, `noInterestPayment`, `interestAmount`, and `paymentDueDate`
- AND the statement is marked `isGenerated = true`

#### Scenario: No generation when cut date has not passed

- GIVEN a `CreditCard` with `cutDay = 15` and the current date is October 10, 2026
- WHEN the user opens the app
- THEN the system does NOT generate any new statement
- AND existing statements are returned unchanged

#### Scenario: Generation respects feature flag

- GIVEN `CREDIT_CARD_REACTIVE_ENABLED = false` in environment configuration
- WHEN the user opens the app
- THEN the system skips the generation trigger entirely
- AND returns existing statements without attempting generation

### Requirement: Multi-Period Catch-Up

The system SHALL generate all missing statements between the last generated statement period and the current date in a single batch operation. The system MUST limit catch-up to a configurable maximum number of periods to prevent unbounded generation after long inactivity.

#### Scenario: Three missed periods generated in one read

- GIVEN a `CreditCard` with last generated statement ending July 15, 2026, and the current date is October 20, 2026
- WHEN the user opens the app
- THEN the system generates three `CardStatement` rows: July 16 – August 15, August 16 – September 15, September 16 – October 15
- AND each statement is generated with the transactions belonging to its respective period

#### Scenario: Catch-up limited by configured maximum

- GIVEN a `CreditCard` with last generated statement ending January 15, 2025, the current date is October 20, 2026, and the maximum catch-up is configured at 12 periods
- WHEN the user opens the app
- THEN the system generates at most 12 statements for the most recent 12 periods
- AND the system logs a warning that older periods were skipped

### Requirement: Frozen Snapshot Semantics

The fields `balance`, `minPayment`, `noInterestPayment`, and `interestAmount` on a generated `CardStatement` MUST be immutable after creation. The fields `paidAmount`, `isPaid`, `remainingBalance`, and `updatedAt` SHALL be mutable to track partial payment progress.

#### Scenario: Frozen fields cannot be modified after generation

- GIVEN a generated `CardStatement` with `balance = 5000.00` and `minPayment = 250.00`
- WHEN a subsequent transaction is created in the same period
- THEN the statement's `balance`, `minPayment`, `noInterestPayment`, and `interestAmount` values do NOT change
- AND the new transaction is linked to the next period's statement

#### Scenario: Mutable fields update on partial payment

- GIVEN a generated `CardStatement` with `balance = 5000.00`, `paidAmount = 0.00`, `isPaid = false`
- WHEN a `PAYMENT` transaction of `2000.00` is applied to the credit card account
- THEN `paidAmount` is updated to `2000.00`
- AND `remainingBalance` is updated to `3000.00`
- AND `isPaid` remains `false`
- AND `updatedAt` is set to the current timestamp

#### Scenario: Statement marked fully paid

- GIVEN a generated `CardStatement` with `balance = 5000.00` and `paidAmount = 3000.00`
- WHEN a `PAYMENT` transaction of `2000.00` is applied
- THEN `paidAmount` is updated to `5000.00`
- AND `remainingBalance` is updated to `0.00`
- AND `isPaid` is set to `true`
- AND `updatedAt` is set to the current timestamp

### Requirement: Statement-Transaction Link

The system MUST assign a `statementId` foreign key to each `Transaction` at generation time based on the transaction's date relative to the statement period. Transactions dated within a statement period are linked to that statement. Transactions dated after the period end are linked to the next period.

#### Scenario: Transaction within period linked to generated statement

- GIVEN a `CreditCard` with period September 15 – October 15 and a transaction dated October 5, 2026
- WHEN the statement for that period is generated
- THEN the transaction's `statementId` is set to the generated statement's `id`
- AND the transaction amount is included in the statement balance calculation

#### Scenario: Transaction after period end linked to next period

- GIVEN a `CreditCard` with period September 15 – October 15 and a transaction dated October 20, 2026
- WHEN the statement for September 15 – October 15 is generated
- THEN the transaction's `statementId` is NOT set to this statement
- AND the transaction is linked to the next period's statement when it is generated

#### Scenario: Transaction before any statement period

- GIVEN a `CreditCard` with first generated period starting September 15, 2026 and a transaction dated August 1, 2026
- WHEN the first statement is generated
- THEN the transaction's `statementId` remains null (no statement covers that date)
- AND the transaction is NOT included in any generated statement balance

### Requirement: Idempotency Guard

The system MUST NOT generate duplicate statements for the same period. An idempotency mechanism (unique constraint on `[creditCardId, periodStart]` or a "last generated period" check) SHALL prevent duplicate generation on repeated reads.

#### Scenario: Repeated read does not duplicate statement

- GIVEN a `CreditCard` with an existing generated statement for September 15 – October 15
- WHEN the user opens the app again on October 16, 2026
- THEN the system does NOT create a new statement for September 15 – October 15
- AND the existing statement is returned

#### Scenario: Concurrent reads do not duplicate

- GIVEN a `CreditCard` with no statement for the current period
- WHEN two read operations arrive simultaneously
- THEN at most one `CardStatement` is created for that period
- AND the losing operation receives the statement created by the winner

### Requirement: Cut Day Handling for Short Months

The system SHALL handle cut days that exceed the number of days in a month by using the last day of that month as the effective cut date.

#### Scenario: Cut day 31 in February

- GIVEN a `CreditCard` with `cutDay = 31`
- WHEN the period ending in February 2026 is calculated
- THEN the effective cut date is February 28, 2026
- AND the period end is February 28, 2026

#### Scenario: Cut day 31 in a 31-day month

- GIVEN a `CreditCard` with `cutDay = 31`
- WHEN the period ending in January 2026 is calculated
- THEN the effective cut date is January 31, 2026

### Requirement: Generated vs Manual Statement Distinction

The system MUST include an `isGenerated` boolean field on `CardStatement` to distinguish auto-generated statements from manually created ones. Auto-generated statements SHALL set `isGenerated = true`.

#### Scenario: Auto-generated statement flagged

- GIVEN a `CreditCard` with a passed cut date
- WHEN the system generates a new statement
- THEN the statement's `isGenerated` field is `true`

#### Scenario: Manual statement retains flag

- GIVEN a `CardStatement` created before the feature was enabled (legacy data)
- THEN the statement's `isGenerated` field is `false` (default)
- AND the statement is not modified by the generation trigger

### Requirement: Payment Waterfall Application

The system SHALL apply partial payments to generated statements in the following order: interest → commissions → ordinary balance → MSI mensualidad → MSCI mensualidad.

> **ASSUMPTION — TODO: Verify against primary Banxico/CONDUSEF source.**
> The exact payment application waterfall is not explicitly stated in primary sources consulted during research. This order is an assumption based on common banking practice. The design phase MUST either confirm this with a primary source or the user MUST explicitly accept this assumption before implementation.

#### Scenario: Payment covers interest and commissions only

- GIVEN a `CardStatement` with `interestAmount = 500.00` and commission transactions totaling `200.00`
- WHEN a `PAYMENT` of `600.00` is applied
- THEN `500.00` is applied to interest, `100.00` to commissions
- AND the remaining `100.00` in commissions carries forward
- AND no amount is applied to ordinary balance

#### Scenario: Payment covers all categories with remainder

- GIVEN a `CardStatement` with `interestAmount = 300.00`, commissions `100.00`, ordinary balance `2000.00`
- WHEN a `PAYMENT` of `2500.00` is applied
- THEN `300.00` covers interest, `100.00` covers commissions, `2100.00` covers ordinary balance
- AND `paidAmount` is `2500.00`
- AND `remainingBalance` reflects the unpaid MSI/MSCI portions