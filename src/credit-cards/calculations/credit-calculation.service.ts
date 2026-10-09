import { Injectable } from "@nestjs/common";
import type { InstallmentPlanStatus } from "../../generated/prisma/client";
import { Prisma } from "../../generated/prisma/client";
import { getNextBusinessDay } from "./business-days.util";
import { getMexicanHolidays } from "./mexican-holidays";

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

// ─── Named constants (Banxico Circular 13/2011 + Mexican tax law) ───

/** IVA rate in Mexico: 16% */
const IVA_RATE = new Decimal(0.16);

/** Banxico day-count convention: 360 days per year */
const DAYS_PER_YEAR = 360;

/** Formula (a): percentage of revolving balance */
const MIN_PAYMENT_REVOLVING_PERCENT = new Decimal(0.015);

/** Formula (b): percentage of credit limit (floor) */
const MIN_PAYMENT_CREDIT_LIMIT_PERCENT = new Decimal(0.0125);

/** Decimal places for money rounding (final result only) */
const MONEY_DECIMAL_PLACES = 2;

interface InterestInput {
	averageDailyBalance: Decimal;
	annualRate: Decimal;
	periodDays: number;
}

interface InterestResult {
	preIva: Decimal;
	iva: Decimal;
	total: Decimal;
}

interface MinimumPaymentInput {
	revolvingBalance: Decimal;
	periodInterest: Decimal;
	creditLimit: Decimal;
	statementBalance: Decimal;
}

interface PngiInput {
	totalSaldoDeudor: Decimal;
	installmentPlans: Array<{
		type: "MSI" | "MSCI";
		remainingBalance: Decimal;
		currentMensualidad: Decimal;
		// Only ACTIVE plans count; COMPLETED, CANCELLED and PAID_OFF are ignored
		status: InstallmentPlanStatus;
	}>;
}

interface WaterfallInput {
	paymentAmount: Decimal;
	interestAmount: Decimal;
	commissionTotal: Decimal;
	ordinaryBalance: Decimal;
	msiMensualidadTotal: Decimal;
	msciMensualidadTotal: Decimal;
}

interface WaterfallResult {
	interestApplied: Decimal;
	commissionsApplied: Decimal;
	ordinaryApplied: Decimal;
	msiApplied: Decimal;
	msciApplied: Decimal;
	remainder: Decimal;
}

@Injectable()
export class CreditCalculationService {
	/**
	 * Calculates the average daily balance over a statement period.
	 *
	 * For each day in the period, the running balance is tracked. EXPENSE increases
	 * the balance, PAYMENT decreases it. Negative balances (saldo a favor) are
	 * clamped to 0 for interest calculation purposes.
	 *
	 * @returns The average daily balance as a Decimal.
	 */
	calculateAverageDailyBalance(
		periodStart: Date,
		periodEnd: Date,
		transactions: Array<{ date: Date; type: string; amount: Decimal }>,
		startingBalance: Decimal,
	): Decimal {
		const start = stripTime(periodStart);
		const end = stripTime(periodEnd);
		const periodDays = daysBetween(start, end) + 1; // inclusive

		// Sort transactions by date
		const sorted = [...transactions].sort(
			(a, b) => stripTime(a.date).getTime() - stripTime(b.date).getTime(),
		);

		let runningBalance = new Decimal(startingBalance);
		let dailyBalanceSum = new Decimal(0);
		let txIndex = 0;

		// Walk day-by-day
		const currentDay = new Date(start);
		for (let dayOffset = 0; dayOffset < periodDays; dayOffset++) {
			// Apply all transactions on this day
			while (
				txIndex < sorted.length &&
				stripTime(sorted[txIndex].date).getTime() === currentDay.getTime()
			) {
				const tx = sorted[txIndex];
				if (tx.type === "EXPENSE") {
					runningBalance = runningBalance.add(tx.amount);
				} else if (tx.type === "PAYMENT") {
					runningBalance = runningBalance.sub(tx.amount);
				}
				txIndex++;
			}

			// Clamp negative balance to 0 for interest calculation
			const effectiveBalance = runningBalance.lt(0) ? new Decimal(0) : runningBalance;
			dailyBalanceSum = dailyBalanceSum.add(effectiveBalance);

			currentDay.setDate(currentDay.getDate() + 1);
		}

		return dailyBalanceSum.div(periodDays);
	}

	calculateInterest(input: InterestInput): InterestResult {
		const preIva = input.averageDailyBalance
			.mul(input.annualRate)
			.div(DAYS_PER_YEAR)
			.mul(input.periodDays);
		const iva = preIva.mul(IVA_RATE);
		const total = preIva.add(iva);
		return { preIva, iva, total };
	}

	calculatePngi(input: PngiInput): Decimal {
		const activePlans = input.installmentPlans.filter((p) => p.status === "ACTIVE");
		const planBalances = activePlans.reduce(
			(sum, p) => sum.add(p.remainingBalance),
			new Decimal(0),
		);
		const mensualidades = activePlans.reduce(
			(sum, p) => sum.add(p.currentMensualidad),
			new Decimal(0),
		);
		return input.totalSaldoDeudor.sub(planBalances).add(mensualidades);
	}

	calculateMinimumPayment(input: MinimumPaymentInput): Decimal {
		// Zero balance → zero minimum payment (credit limit floor does NOT override)
		if (input.statementBalance.eq(0) && input.periodInterest.eq(0)) {
			return new Decimal(0);
		}

		// Formula (a): 1.5% × revolvingBalance + periodInterest (IVA-inclusive)
		const formulaA = input.revolvingBalance
			.mul(MIN_PAYMENT_REVOLVING_PERCENT)
			.add(input.periodInterest);

		// Formula (b): 1.25% × creditLimit
		const formulaB = input.creditLimit.mul(MIN_PAYMENT_CREDIT_LIMIT_PERCENT);

		// Take the greater of the two formulas
		const formulaResult = formulaA.gte(formulaB) ? formulaA : formulaB;

		// Cap at statement balance — minimum payment must not exceed what is owed
		const capped = formulaResult.lte(input.statementBalance)
			? formulaResult
			: input.statementBalance;

		// Round to 2 decimal places (no intermediate rounding until final result)
		return capped.toDecimalPlaces(MONEY_DECIMAL_PLACES);
	}

	calculatePaymentDueDate(cutDate: Date, paymentDueDays: number): Date {
		// Add paymentDueDays to cutDate
		const rawDueDate = new Date(cutDate);
		rawDueDate.setDate(rawDueDate.getDate() + paymentDueDays);
		rawDueDate.setHours(0, 0, 0, 0);

		// Build holiday list for the due date's year (and previous year for year-boundary cases)
		const year = rawDueDate.getFullYear();
		const holidays = [...getMexicanHolidays(year - 1), ...getMexicanHolidays(year)];

		// Adjust to next business day (skips weekends + holidays, forward only)
		return getNextBusinessDay(rawDueDate, holidays);
	}

	// ASSUMPTION — TODO: Verify against primary Banxico/CONDUSEF source.
	// Order: interest → commissions → ordinary → MSI → MSCI
	// This is an assumption based on common banking practice, not a confirmed
	// primary-source rule. See proposal "Payment waterfall" risk and
	// specs/statement-generation "Payment Waterfall Application" requirement.
	applyPaymentWaterfall(input: WaterfallInput): WaterfallResult {
		let remaining = new Decimal(input.paymentAmount);

		// 1. Interest
		const interestApplied = Decimal.min(remaining, input.interestAmount);
		remaining = remaining.sub(interestApplied);

		// 2. Commissions
		const commissionsApplied = Decimal.min(remaining, input.commissionTotal);
		remaining = remaining.sub(commissionsApplied);

		// 3. Ordinary balance
		const ordinaryApplied = Decimal.min(remaining, input.ordinaryBalance);
		remaining = remaining.sub(ordinaryApplied);

		// 4. MSI mensualidad
		const msiApplied = Decimal.min(remaining, input.msiMensualidadTotal);
		remaining = remaining.sub(msiApplied);

		// 5. MSCI mensualidad
		const msciApplied = Decimal.min(remaining, input.msciMensualidadTotal);
		remaining = remaining.sub(msciApplied);

		return {
			interestApplied,
			commissionsApplied,
			ordinaryApplied,
			msiApplied,
			msciApplied,
			remainder: remaining,
		};
	}

	// ASSUMPTION — TODO: Verify exact MSCI amortization method against primary sources.
	// Simplified: simple interest divided by months. Real banks likely use declining-balance
	// amortization (interest accrues on remaining principal, not original).
	calculateMsciMonthlyAmount(principal: Decimal, rate: Decimal, totalMonths: number): Decimal {
		const monthlyPrincipal = principal.div(totalMonths);
		const monthlyInterest = principal.mul(rate).div(totalMonths);
		return monthlyPrincipal.add(monthlyInterest);
	}
}

/** Returns a new Date with time components zeroed (midnight local). */
function stripTime(date: Date): Date {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d;
}

/** Returns the number of whole days between two dates (end - start). */
function daysBetween(start: Date, end: Date): number {
	const msPerDay = 1000 * 60 * 60 * 24;
	return Math.round((end.getTime() - start.getTime()) / msPerDay);
}
