# Available Credit Specification

## Purpose

Defines the `availableCredit` computed field returned on `CreditCard` responses. This field represents the remaining credit available for spending, calculated as `creditLimit - account.balance`. The field is computed at the DTO/response layer and is NOT persisted in the database, preserving the existing `account.balance` semantics.

## Requirements

### Requirement: Available Credit Computation

The system SHALL compute `availableCredit = creditLimit - account.balance` on every `CreditCard` response. The computation MUST use Decimal arithmetic. The field MUST appear on both single-card (`findOne`) and list (`findAll`) responses.

#### Scenario: Positive available credit

- GIVEN a `CreditCard` with `creditLimit = 10000.00` and `account.balance = 3000.00`
- WHEN the card is retrieved via the API
- THEN the response includes `availableCredit = 7000.00`

#### Scenario: Fully utilized credit

- GIVEN a `CreditCard` with `creditLimit = 10000.00` and `account.balance = 10000.00`
- WHEN the card is retrieved via the API
- THEN the response includes `availableCredit = 0.00`

#### Scenario: Over-limit balance shows negative available credit

- GIVEN a `CreditCard` with `creditLimit = 10000.00` and `account.balance = 12000.00`
- WHEN the card is retrieved via the API
- THEN the response includes `availableCredit = -2000.00`

#### Scenario: Saldo a favor increases available credit

- GIVEN a `CreditCard` with `creditLimit = 10000.00` and `account.balance = -1000.00` (saldo a favor)
- WHEN the card is retrieved via the API
- THEN the response includes `availableCredit = 11000.00`

### Requirement: No Storage of Available Credit

The system MUST NOT persist `availableCredit` in the database. The field is computed exclusively at the response serialization layer. The `account.balance` field on the `Account` model is the single source of truth for the current balance.

#### Scenario: availableCredit not in database schema

- GIVEN the `CreditCard` Prisma model
- THEN there is no `availableCredit` column in the `credit_cards` table
- AND the field is added only in the response DTO mapping

#### Scenario: Available credit reflects real-time balance

- GIVEN a `CreditCard` with `creditLimit = 10000.00` and `account.balance = 2000.00`
- WHEN an `EXPENSE` of `3000.00` is created on the card
- AND the card is retrieved again
- THEN `availableCredit = 10000.00 - 5000.00 = 5000.00` (reflects the new balance immediately)

### Requirement: Response DTO Inclusion

The `CreditCard` response DTO SHALL include the following computed fields alongside stored fields: `availableCredit` (computed), `currentBalance` (mapped from `account.balance`), and `nextPaymentDueDate` (from the latest unpaid statement's `paymentDueDate`).

#### Scenario: Full response DTO

- GIVEN a `CreditCard` with `creditLimit = 10000.00`, `account.balance = 4000.00`, and a latest unpaid statement with `paymentDueDate = November 4, 2026`
- WHEN the card is retrieved via the API
- THEN the response includes `availableCredit = 6000.00`
- AND the response includes `currentBalance = 4000.00`
- AND the response includes `nextPaymentDueDate = "2026-11-04"`

#### Scenario: No unpaid statement — nextPaymentDueDate is null

- GIVEN a `CreditCard` with all statements paid and no pending statement
- WHEN the card is retrieved via the API
- THEN `availableCredit` is computed normally
- AND `nextPaymentDueDate` is `null`

### Requirement: List Responses Include Available Credit

The system SHALL include `availableCredit` in list responses, including `findAll` on the credit-cards endpoint and any bank-level credit card listings (`findCreditCardsByBank`).

#### Scenario: findAll returns availableCredit for each card

- GIVEN two `CreditCard` entries for the user, one with `creditLimit = 10000.00, balance = 2000.00` and another with `creditLimit = 5000.00, balance = 5000.00`
- WHEN the user calls `GET /api/credit-cards`
- THEN the response array includes `availableCredit = 8000.00` for the first card
- AND `availableCredit = 0.00` for the second card

#### Scenario: Bank-level card listing includes availableCredit

- GIVEN a `Bank` with two credit card accounts
- WHEN the user calls the bank's credit card listing endpoint
- THEN each card in the response includes `availableCredit`

### Requirement: Decimal Arithmetic and Rounding

The system SHALL compute `availableCredit` using Decimal arithmetic. The result SHALL be rounded to 2 decimal places for the response.

#### Scenario: Decimal precision preserved

- GIVEN a `CreditCard` with `creditLimit = 10000.00` and `account.balance = 3333.33`
- WHEN `availableCredit` is computed
- THEN `availableCredit = 6666.67` (rounded to 2 decimal places)