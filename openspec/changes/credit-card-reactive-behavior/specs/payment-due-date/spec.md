# Payment Due Date Specification

## Purpose

Defines the derivation of the payment due date from the cut date plus a configurable offset (default 20 natural days), with adjustment to the next business day when the result falls on a non-business day. This replaces the current fixed `paymentDay` field on `CreditCard` with `paymentDueDays` (an offset from the cut date), matching how real Mexican credit card contracts work.

## Requirements

### Requirement: Payment Due Date Derivation

The system SHALL derive the payment due date as `paymentDueDate = cutDate + paymentDueDays`. The `paymentDueDays` is a configurable integer on `CreditCard` with a default value of `20` natural days. The system MUST NOT use a fixed day-of-month for the due date.

#### Scenario: Standard 20-day offset

- GIVEN a `CreditCard` with `cutDay = 15` and `paymentDueDays = 20`
- WHEN a statement is generated for the period ending October 15, 2026
- THEN `paymentDueDate = October 15, 2026 + 20 days = November 4, 2026`

#### Scenario: Custom offset

- GIVEN a `CreditCard` with `cutDay = 1` and `paymentDueDays = 15`
- WHEN a statement is generated for the period ending November 1, 2026
- THEN `paymentDueDate = November 1, 2026 + 15 days = November 16, 2026`

#### Scenario: Default offset when paymentDueDays is null

- GIVEN a `CreditCard` with `paymentDueDays = null` (migrated from old `paymentDay` field)
- WHEN a statement is generated
- THEN the system uses the default `paymentDueDays = 20`
- AND `paymentDueDate = cutDate + 20 days`

### Requirement: Non-Business Day Adjustment

The system SHALL adjust the payment due date to the next business day when the calculated date falls on a Saturday, Sunday, or a Mexican national holiday. The system MUST NOT move the date backward — adjustment is always forward.

#### Scenario: Due date falls on Saturday

- GIVEN a calculated `paymentDueDate` of Saturday, November 7, 2026
- WHEN the non-business day adjustment is applied
- THEN the adjusted `paymentDueDate` is Monday, November 9, 2026 (skipping Sunday)

#### Scenario: Due date falls on Sunday

- GIVEN a calculated `paymentDueDate` of Sunday, November 8, 2026
- WHEN the non-business day adjustment is applied
- THEN the adjusted `paymentDueDate` is Monday, November 9, 2026

#### Scenario: Due date falls on a Mexican national holiday

- GIVEN a calculated `paymentDueDate` of September 16, 2026 (Día de la Independencia)
- WHEN the non-business day adjustment is applied
- THEN the adjusted `paymentDueDate` is September 17, 2026 (assuming it is a business day)

#### Scenario: Holiday followed by weekend

- GIVEN a calculated `paymentDueDate` of Friday, September 16, 2026 (holiday)
- WHEN the non-business day adjustment is applied
- THEN the adjusted `paymentDueDate` is Monday, September 19, 2026

#### Scenario: Due date already on a business day

- GIVEN a calculated `paymentDueDate` of Wednesday, November 4, 2026
- WHEN the non-business day adjustment is applied
- THEN the `paymentDueDate` remains November 4, 2026 (no adjustment)

### Requirement: Holiday Source

The system SHALL use a hardcoded or configurable list of Mexican national holidays for v1. The system MUST NOT depend on an external holiday API. The holiday list SHALL include at minimum: January 1, February 5 (Constitución), March 21 (Benito Juárez), May 1 (Trabajo), September 16 (Independencia), November 20 (Revolución), December 25 (Navidad), and movable holidays as observed.

> **Note**: Movable holidays (e.g., those observed on the first Monday of a month) SHOULD be documented in the design phase with the exact observation rules. The spec requires that the system handle them; the exact list is an implementation detail.

#### Scenario: New Year's Day is a holiday

- GIVEN a calculated `paymentDueDate` of January 1, 2027
- WHEN the non-business day adjustment is applied
- THEN the adjusted `paymentDueDate` is January 2, 2027 (assuming it is a business day)

#### Scenario: Holiday list is configurable

- GIVEN a system with a custom holiday list that does NOT include November 20
- WHEN a calculated `paymentDueDate` falls on November 20
- THEN the date is NOT adjusted (it is treated as a business day)

### Requirement: Migration from paymentDay to paymentDueDays

The system SHALL migrate existing `CreditCard` rows from the fixed `paymentDay` field to `paymentDueDays`. The migration MUST backfill `paymentDueDays = 20` (default) for all existing rows. The `paymentDay` field SHALL be retained as nullable and deprecated during the transition window.

#### Scenario: Existing card migrated to default offset

- GIVEN an existing `CreditCard` with `paymentDay = 10` and no `paymentDueDays`
- WHEN the migration runs
- THEN `paymentDueDays` is set to `20`
- AND `paymentDay` is retained as `10` (nullable, deprecated)

#### Scenario: New card uses paymentDueDays

- GIVEN a new `CreditCard` created via the API after the feature is enabled
- THEN the create DTO accepts `paymentDueDays` (not `paymentDay`)
- AND `paymentDueDays` is stored on the card
- AND `paymentDay` is not set (or set to null)

### Requirement: Payment Due Date Stored on Statement

The system MUST store the calculated and adjusted `paymentDueDate` on the `CardStatement` at generation time. The stored value is a frozen snapshot and MUST NOT be recalculated after generation.

#### Scenario: Due date frozen on statement

- GIVEN a `CardStatement` generated with `paymentDueDate = November 4, 2026`
- WHEN the statement is read at a later date
- THEN `paymentDueDate` is still `November 4, 2026`
- AND it does not change even if the holiday list is updated

#### Scenario: Due date visible in dashboard

- GIVEN a `CardStatement` with `paymentDueDate = November 4, 2026` and `isPaid = false`
- WHEN the dashboard computes the credit overview
- THEN the `nextPaymentDueDate` field is `November 4, 2026` (not `periodEnd`)