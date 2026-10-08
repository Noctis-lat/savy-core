# Minimum Payment Calculation Specification

## Purpose

Defines the minimum payment calculation per Banxico Circular 13/2011. The formula ensures the minimum payment covers interest, IVA, and a percentage of the revolving balance, with a floor based on the credit limit. This replaces the current model where the caller manually supplies `minPayment`.

## Requirements

### Requirement: Minimum Payment Formula

The system SHALL calculate the minimum payment as the greater of: (a) `1.5% × revolvingBalance + periodInterest + IVA`, or (b) `1.25% × creditLimit`. The `revolvingBalance` is the statement balance excluding MSI/MSCI plan balances plus current mensualidades. The `periodInterest` and IVA are the interest charge calculated for the period (per the interest-calculation spec).

#### Scenario: Formula (a) wins when revolving balance is high

- GIVEN a revolving balance of `5000.00`, period interest (pre-IVA) of `45.00`, IVA of `7.20`, and a credit limit of `10000.00`
- WHEN the minimum payment is calculated
- THEN formula (a) = `1.5% × 5000.00 + 45.00 + 7.20 = 75.00 + 52.20 = 127.20`
- AND formula (b) = `1.25% × 10000.00 = 125.00`
- AND `minPayment = max(127.20, 125.00) = 127.20`

#### Scenario: Formula (b) wins when revolving balance is low

- GIVEN a revolving balance of `1000.00`, period interest of `0.00` (paid in full prior period), and a credit limit of `20000.00`
- WHEN the minimum payment is calculated
- THEN formula (a) = `1.5% × 1000.00 + 0.00 = 15.00`
- AND formula (b) = `1.25% × 20000.00 = 250.00`
- AND `minPayment = max(15.00, 250.00) = 250.00`

#### Scenario: No interest when prior period paid in full

- GIVEN a revolving balance of `5000.00`, prior period paid in full (interest = `0.00`), and a credit limit of `10000.00`
- WHEN the minimum payment is calculated
- THEN formula (a) = `1.5% × 5000.00 + 0.00 = 75.00`
- AND formula (b) = `1.25% × 10000.00 = 125.00`
- AND `minPayment = 125.00`

### Requirement: Balance Cap

The system SHALL cap the calculated minimum payment at the statement balance if the formula result exceeds the balance. The minimum payment MUST NOT exceed what the user owes.

#### Scenario: Formula exceeds balance

- GIVEN a revolving balance of `500.00`, a credit limit of `50000.00`, and no interest
- WHEN the minimum payment is calculated
- THEN formula (b) = `1.25% × 50000.00 = 625.00`
- AND the statement balance is `500.00`
- AND `minPayment = min(625.00, 500.00) = 500.00`

#### Scenario: Formula below balance uses formula result

- GIVEN a revolving balance of `5000.00`, a credit limit of `10000.00`, and interest of `52.20`
- WHEN the minimum payment is calculated
- THEN `minPayment = 127.20` (formula result, which is below balance `5000.00`)

### Requirement: Revolving Balance Excludes Installment Plans

The `revolvingBalance` used in the minimum payment formula SHALL exclude MSI and MSCI plan balances but SHALL include the current month's mensualidad of those plans. This matches the PNGI definition.

#### Scenario: Revolving balance with MSI plan

- GIVEN a statement balance of `8000.00`, an MSI plan with remaining balance `6000.00` and current mensualidad `500.00`
- WHEN the revolving balance is calculated
- THEN `revolvingBalance = 8000.00 - 6000.00 + 500.00 = 2500.00`
- AND the minimum payment formula uses `2500.00`

#### Scenario: Revolving balance with no installment plans

- GIVEN a statement balance of `5000.00` and no active installment plans
- WHEN the revolving balance is calculated
- THEN `revolvingBalance = 5000.00`

### Requirement: Decimal Arithmetic Only

The system MUST use Decimal arithmetic for all minimum payment calculations. Float arithmetic is prohibited. Intermediate results SHALL NOT be rounded until the final `minPayment` value, which is rounded to 2 decimal places.

#### Scenario: No intermediate rounding

- GIVEN a revolving balance of `3333.33` and a credit limit of `12345.67`
- WHEN the minimum payment is calculated
- THEN all intermediate calculations preserve full precision
- AND only the final `minPayment` is rounded to 2 decimal places

### Requirement: Zero Balance Produces Zero Minimum Payment

The system SHALL set `minPayment = 0.00` when the statement balance is zero and there is no interest charge.

#### Scenario: Zero balance, zero interest

- GIVEN a statement balance of `0.00` and `interestAmount = 0.00`
- WHEN the minimum payment is calculated
- THEN `minPayment = 0.00`
- AND the credit limit floor does NOT override the zero because balance is zero

#### Scenario: Zero balance with credit limit floor

- GIVEN a statement balance of `0.00`, `interestAmount = 0.00`, and a credit limit of `50000.00`
- WHEN the minimum payment is calculated
- THEN `minPayment = 0.00` (balance cap zeroes out the formula (b) floor)