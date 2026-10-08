# Interest Calculation Specification

## Purpose

Defines the average daily balance interest calculation per the Banxico formula, including IVA 16% application and the conditional trigger based on previous-period payment versus PNGI (pago para no generar intereses). This is the core calculation that makes Savy's credit card numbers match real bank statements.

## Requirements

### Requirement: Average Daily Balance Calculation

The system SHALL calculate the average daily balance over the statement period using the formula: `avgDailyBalance = sum(dailyBalance for each day in period) / periodDays`. The system MUST use Decimal arithmetic throughout — Float is prohibited for all money and rate calculations.

#### Scenario: Single purchase mid-period

- GIVEN a credit card with zero balance at period start, a period of 30 days, and an `EXPENSE` of `3000.00` on day 15
- WHEN the average daily balance is calculated
- THEN days 1–14 have a daily balance of `0.00` and days 15–30 have a daily balance of `3000.00`
- AND the average daily balance is `(0 × 14 + 3000 × 15) / 30 = 1500.00`

#### Scenario: Multiple purchases across period

- GIVEN a credit card with zero balance at period start, a period of 30 days, an `EXPENSE` of `1000.00` on day 5 and an `EXPENSE` of `2000.00` on day 20
- WHEN the average daily balance is calculated
- THEN days 1–4 have balance `0.00`, days 5–19 have balance `1000.00`, days 20–30 have balance `3000.00`
- AND the average daily balance is `(0 × 4 + 1000 × 15 + 3000 × 11) / 30 = 1600.00`

#### Scenario: Payment reduces balance mid-period

- GIVEN a credit card with balance `5000.00` at period start, a period of 30 days, and a `PAYMENT` of `2000.00` on day 10
- WHEN the average daily balance is calculated
- THEN days 1–9 have balance `5000.00`, days 10–30 have balance `3000.00`
- AND the average daily balance is `(5000 × 9 + 3000 × 21) / 30 = 3600.00`

### Requirement: Interest Formula

The system SHALL calculate interest using the Banxico formula: `interest = avgDailyBalance × (annualRate / 360) × periodDays`. The `annualRate` is the `CreditCard.interestRate` stored as a decimal (e.g., `0.3600 = 36%`).

#### Scenario: Standard interest calculation

- GIVEN an average daily balance of `1500.00`, an annual rate of `0.3600` (36%), and a period of 30 days
- WHEN interest is calculated
- THEN `interest = 1500.00 × (0.3600 / 360) × 30 = 1500.00 × 0.001 × 30 = 45.00`

#### Scenario: Zero balance produces zero interest

- GIVEN an average daily balance of `0.00`
- WHEN interest is calculated
- THEN `interest = 0.00`

### Requirement: IVA Application

The system SHALL apply IVA at 16% on the calculated interest amount: `totalInterestCharge = interest × 1.16`. The stored `interestAmount` on the `CardStatement` MUST reflect the IVA-inclusive total.

#### Scenario: IVA added to interest

- GIVEN a calculated interest of `45.00` (pre-IVA)
- WHEN IVA is applied
- THEN `interestAmount = 45.00 × 1.16 = 52.20`

#### Scenario: Zero interest produces zero IVA charge

- GIVEN a calculated interest of `0.00` (pre-IVA)
- WHEN IVA is applied
- THEN `interestAmount = 0.00`

### Requirement: Conditional Interest Trigger

The system SHALL charge interest ONLY when the previous period's payment was less than the previous period's PNGI (pago para no generar intereses). If the previous period was paid in full (payment >= PNGI), the system MUST NOT charge interest for the current period.

#### Scenario: Interest charged when payment below PNGI

- GIVEN a previous statement with `noInterestPayment = 5000.00` and `paidAmount = 3000.00`
- WHEN the current period statement is generated
- THEN interest IS calculated and applied because `3000.00 < 5000.00`

#### Scenario: No interest when payment equals PNGI

- GIVEN a previous statement with `noInterestPayment = 5000.00` and `paidAmount = 5000.00`
- WHEN the current period statement is generated
- THEN `interestAmount = 0.00` because payment met the no-interest threshold

#### Scenario: No interest when payment exceeds PNGI

- GIVEN a previous statement with `noInterestPayment = 5000.00` and `paidAmount = 5500.00` (saldo a favor)
- WHEN the current period statement is generated
- THEN `interestAmount = 0.00`

#### Scenario: First statement has no interest (no previous period)

- GIVEN a credit card with no prior `CardStatement` (first generation)
- WHEN the first statement is generated
- THEN `interestAmount = 0.00` because there is no previous period to evaluate

### Requirement: PNGI Calculation

The system SHALL calculate PNGI as: `pngi = totalSaldoDeudor - msiMsciPlanBalances + currentMensualidadOfPlans`. MSI and MSCI plan balances are excluded from the no-interest payment because their interest is handled by the plan terms, not the revolving rate. The current month's mensualidad of those plans IS included because it must be paid.

#### Scenario: PNGI with no installment plans

- GIVEN a total saldo deudor of `5000.00` and no active `InstallmentPlan` rows
- WHEN PNGI is calculated
- THEN `pngi = 5000.00`

#### Scenario: PNGI excludes MSI balance, includes mensualidad

- GIVEN a total saldo deudor of `8000.00`, one active MSI plan with remaining balance `6000.00` and current mensualidad `500.00`
- WHEN PNGI is calculated
- THEN `pngi = 8000.00 - 6000.00 + 500.00 = 2500.00`

#### Scenario: PNGI with multiple installment plans

- GIVEN a total saldo deudor of `10000.00`, an MSI plan with balance `3000.00` and mensualidad `500.00`, and an MSCI plan with balance `4000.00` and mensualidad `700.00`
- WHEN PNGI is calculated
- THEN `pngi = 10000.00 - 3000.00 - 4000.00 + 500.00 + 700.00 = 4200.00`

### Requirement: Saldo a Favor Handling in Interest

The system SHALL treat a negative account balance (saldo a favor / overpayment) as a zero or negative daily balance in the average daily balance calculation. A saldo a favor MUST reduce the average daily balance, potentially producing zero interest.

#### Scenario: Saldo a favor reduces average daily balance

- GIVEN a credit card with balance `-1000.00` (saldo a favor) at period start, a period of 30 days, and an `EXPENSE` of `2000.00` on day 15
- WHEN the average daily balance is calculated
- THEN days 1–14 have balance `-1000.00` (treated as `0.00` for interest purposes), days 15–30 have balance `1000.00`
- AND the average daily balance is `(0 × 14 + 1000 × 15) / 30 = 500.00`

#### Scenario: Full period with saldo a favor produces zero interest

- GIVEN a credit card with balance `-500.00` for the entire 30-day period and no new purchases
- WHEN the average daily balance is calculated
- THEN the daily balance is treated as `0.00` for each day
- AND `interestAmount = 0.00`