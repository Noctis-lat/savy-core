import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CreditCalculationService } from "../credit-cards/calculations/credit-calculation.service";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

/** Default catch-up limit when env var is not set. */
const DEFAULT_MAX_CATCH_UP_PERIODS = 12;

interface CreditCardForGeneration {
	id: string;
	accountId: string;
	cutDay: number;
	interestRate: Decimal;
	creditLimit: Decimal;
	paymentDueDays: number | null;
}

interface Period {
	periodStart: Date;
	periodEnd: Date;
}

/**
 * StatementGenerationService — orchestrator that lazily generates missing
 * CardStatement rows for credit cards on read.
 *
 * No-op when CREDIT_CARD_REACTIVE_ENABLED is false. Multi-period catch-up
 * limited by CREDIT_CARD_MAX_CATCH_UP_PERIODS (default 12). Single Prisma
 * transaction per card ensures all-or-nothing generation.
 */
@Injectable()
export class StatementGenerationService {
	private readonly logger = new Logger(StatementGenerationService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly calculationService: CreditCalculationService,
		private readonly configService: ConfigService,
	) {}

	async generatePending(profileId: string): Promise<void> {
		if (!this.isReactiveEnabled()) {
			return;
		}

		const cards = await this.prisma.creditCard.findMany({
			where: { account: { profileId } },
			include: { account: true },
		});

		for (const card of cards) {
			await this.generateForCard(card as unknown as CreditCardForGeneration);
		}
	}

	/**
	 * Generates all missing statements for a single credit card inside one
	 * Prisma transaction. All-or-nothing: if any period fails, none are
	 * committed.
	 */
	private async generateForCard(card: CreditCardForGeneration): Promise<void> {
		await this.prisma.$transaction(async (tx) => {
			// Find the latest existing statement for this card
			const lastStatement = await tx.cardStatement.findFirst({
				where: { creditCardId: card.id },
				orderBy: { periodEnd: "desc" },
				take: 1,
			});

			const now = new Date(Date.now());
			const maxCatchUp = this.getMaxCatchUpPeriods();
			const periods = this.computeMissedPeriods(
				lastStatement?.periodEnd ?? null,
				card.cutDay,
				now,
				maxCatchUp,
			);

			if (periods.length > maxCatchUp) {
				this.logger.warn(
					`Card ${card.id}: ${periods.length} missed periods exceed max catch-up of ${maxCatchUp}. ` +
						`Generating only the most recent ${maxCatchUp}. Older periods skipped.`,
				);
			}

			for (const period of periods) {
				await this.generatePeriod(tx, card, period);
			}
		});
	}

	/**
	 * Generates a single statement for one period. Idempotent: if a statement
	 * already exists for (creditCardId, periodStart), it is skipped.
	 */
	private async generatePeriod(
		tx: Prisma.TransactionClient,
		card: CreditCardForGeneration,
		period: Period,
	): Promise<void> {
		// Idempotency check — DB unique constraint is the safety net
		const existing = await tx.cardStatement.findUnique({
			where: {
				creditCardId_periodStart: {
					creditCardId: card.id,
					periodStart: period.periodStart,
				},
			},
		});
		if (existing) {
			return;
		}

		// Fetch account balance at period end (carried-forward balance)
		const account = await tx.account.findFirst({
			where: { id: card.accountId },
			select: { balance: true },
		});
		const startingBalance = account?.balance ?? new Decimal(0);

		// Query transactions in the period that are not yet linked to a statement
		const periodTransactions = await tx.transaction.findMany({
			where: {
				accountId: card.accountId,
				date: { gte: period.periodStart, lte: period.periodEnd },
				statementId: null,
			},
		});

		// Calculate totals via the pure calculation engine
		const avgDailyBalance = this.calculationService.calculateAverageDailyBalance(
			period.periodStart,
			period.periodEnd,
			periodTransactions.map((t) => ({ date: t.date, type: t.type, amount: t.amount })),
			startingBalance,
		);

		const interestResult = this.calculationService.calculateInterest({
			averageDailyBalance: avgDailyBalance,
			annualRate: card.interestRate,
			periodDays: this.daysInPeriod(period.periodStart, period.periodEnd),
		});

		// Fetch active installment plans for PNGI and mensualidad totals
		const activePlans = await tx.installmentPlan.findMany({
			where: {
				transaction: { accountId: card.accountId },
				status: "ACTIVE",
			},
			include: { transaction: true },
		});

		const pngi = this.calculationService.calculatePngi({
			totalSaldoDeudor: startingBalance,
			installmentPlans: activePlans.map((p) => ({
				type: p.type,
				remainingBalance: p.monthlyAmount.mul(p.totalMonths - p.currentMonth),
				currentMensualidad: p.monthlyAmount,
				status: p.status,
			})),
		});

		const minPayment = this.calculationService.calculateMinimumPayment({
			revolvingBalance: pngi,
			periodInterest: interestResult.total,
			creditLimit: card.creditLimit,
			statementBalance: startingBalance,
		});

		const paymentDueDate = this.calculationService.calculatePaymentDueDate(
			period.periodEnd,
			card.paymentDueDays ?? 20,
		);

		// Create the frozen statement
		const statement = await tx.cardStatement.create({
			data: {
				creditCardId: card.id,
				periodStart: period.periodStart,
				periodEnd: period.periodEnd,
				balance: startingBalance,
				minPayment,
				noInterestPayment: startingBalance,
				interestAmount: interestResult.total,
				paymentDueDate,
				isGenerated: true,
			},
		});

		// Link transactions to the generated statement
		if (periodTransactions.length > 0) {
			await tx.transaction.updateMany({
				where: { id: { in: periodTransactions.map((t) => t.id) } },
				data: { statementId: statement.id },
			});
		}

		// Advance active installment plans (currentMonth++, transition to COMPLETED)
		for (const plan of activePlans) {
			const nextMonth = plan.currentMonth + 1;
			if (nextMonth >= plan.totalMonths) {
				await tx.installmentPlan.update({
					where: { id: plan.id },
					data: { currentMonth: nextMonth, status: "COMPLETED" },
				});
			} else {
				await tx.installmentPlan.update({
					where: { id: plan.id },
					data: { currentMonth: nextMonth },
				});
			}
		}
	}

	// ─── Period computation helpers (extracted in T-029) ───

	/**
	 * Computes the list of missing statement periods between the last
	 * generated statement and the current date. Each period is one month
	 * ending on the card's cut day.
	 *
	 * Periods are ordered oldest-first so they are generated sequentially.
	 */
	private computeMissedPeriods(
		lastPeriodEnd: Date | null,
		cutDay: number,
		now: Date,
		maxCatchUp: number,
	): Period[] {
		const periods: Period[] = [];

		// Normalize `now` to date-only (midnight local) for consistent comparison
		const nowMidnight = new Date(now);
		nowMidnight.setHours(0, 0, 0, 0);

		// Start from the day after the last statement's periodEnd (or from one month before now if none)
		let cursor: Date;
		if (lastPeriodEnd) {
			cursor = new Date(lastPeriodEnd);
			cursor.setHours(0, 0, 0, 0);
			cursor.setDate(cursor.getDate() + 1);
		} else {
			// No prior statement — start from the period ending in the previous cut month
			cursor = this.computePreviousCutPeriodStart(cutDay, now);
		}

		// Generate periods until we reach the current date
		while (periods.length < maxCatchUp) {
			const periodStart = new Date(cursor);
			const periodEnd = this.computePeriodEnd(periodStart, cutDay);

			// Only generate if the cut date has passed (periodEnd is before today)
			if (periodEnd >= nowMidnight) {
				break;
			}

			periods.push({ periodStart, periodEnd });

			// Advance cursor to the next period start (day after periodEnd, at midnight)
			const nextStart = new Date(periodEnd);
			nextStart.setHours(0, 0, 0, 0);
			nextStart.setDate(nextStart.getDate() + 1);
			cursor = nextStart;
		}

		return periods;
	}

	/**
	 * Computes the period end date for a given period start and cut day.
	 * The period end is the next cut day AFTER the period start.
	 * Handles short months: cut day 31 in February → Feb 28.
	 */
	private computePeriodEnd(periodStart: Date, cutDay: number): Date {
		const startMonth = periodStart.getMonth();
		const startYear = periodStart.getFullYear();

		// Check if the cut day in the same month as periodStart is AFTER periodStart
		const effectiveCutDaySameMonth = this.getEffectiveCutDay(cutDay, startYear, startMonth);
		const sameMonthCut = new Date(startYear, startMonth, effectiveCutDaySameMonth);
		sameMonthCut.setHours(23, 59, 59, 999);

		if (sameMonthCut > periodStart) {
			// The cut in the same month is after periodStart → period ends there
			return sameMonthCut;
		}

		// Otherwise, the cut is in the next month
		const nextMonth = startMonth + 1 > 11 ? 0 : startMonth + 1;
		const nextYear = startMonth + 1 > 11 ? startYear + 1 : startYear;
		const effectiveCutDayNext = this.getEffectiveCutDay(cutDay, nextYear, nextMonth);
		const periodEnd = new Date(nextYear, nextMonth, effectiveCutDayNext);
		periodEnd.setHours(23, 59, 59, 999);
		return periodEnd;
	}

	/**
	 * Returns the effective cut day for a given year/month, clamping to the
	 * last day of the month when the cut day exceeds the month's length.
	 */
	private getEffectiveCutDay(cutDay: number, year: number, month: number): number {
		const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
		return Math.min(cutDay, lastDayOfMonth);
	}

	/**
	 * Computes the period start for the first statement when no prior
	 * statement exists. This is the day after the cut day of the month
	 * BEFORE the most recent passed cut date.
	 *
	 * Example: cutDay 15, now Oct 16 → most recent passed cut = Oct 15 →
	 * period start = Sep 16 (day after Sep 15 cut).
	 */
	private computePreviousCutPeriodStart(cutDay: number, now: Date): Date {
		const currentMonth = now.getMonth();
		const currentYear = now.getFullYear();

		// Find the most recent cut date that has passed
		const effectiveCutDayThisMonth = this.getEffectiveCutDay(cutDay, currentYear, currentMonth);
		const thisMonthCut = new Date(currentYear, currentMonth, effectiveCutDayThisMonth);
		thisMonthCut.setHours(23, 59, 59, 999);

		let mostRecentCut: Date;
		if (thisMonthCut < now) {
			// Cut this month has passed
			mostRecentCut = thisMonthCut;
		} else {
			// Cut this month hasn't passed yet — use previous month's cut
			const prevMonth = currentMonth - 1 < 0 ? 11 : currentMonth - 1;
			const prevYear = currentMonth - 1 < 0 ? currentYear - 1 : currentYear;
			const effectiveCutDayPrev = this.getEffectiveCutDay(cutDay, prevYear, prevMonth);
			mostRecentCut = new Date(prevYear, prevMonth, effectiveCutDayPrev);
			mostRecentCut.setHours(23, 59, 59, 999);
		}

		// Period start is the day after the cut of the month BEFORE mostRecentCut
		const startMonth = mostRecentCut.getMonth() - 1 < 0 ? 11 : mostRecentCut.getMonth() - 1;
		const startYear =
			mostRecentCut.getMonth() - 1 < 0
				? mostRecentCut.getFullYear() - 1
				: mostRecentCut.getFullYear();
		const effectiveCutDayStart = this.getEffectiveCutDay(cutDay, startYear, startMonth);
		const start = new Date(startYear, startMonth, effectiveCutDayStart);
		start.setDate(start.getDate() + 1);
		start.setHours(0, 0, 0, 0);
		return start;
	}

	private daysInPeriod(periodStart: Date, periodEnd: Date): number {
		const msPerDay = 1000 * 60 * 60 * 24;
		const start = new Date(periodStart);
		start.setHours(0, 0, 0, 0);
		const end = new Date(periodEnd);
		end.setHours(0, 0, 0, 0);
		return Math.round((end.getTime() - start.getTime()) / msPerDay) + 1;
	}

	private isReactiveEnabled(): boolean {
		return this.configService.get<string>("CREDIT_CARD_REACTIVE_ENABLED") === "true";
	}

	private getMaxCatchUpPeriods(): number {
		const raw = this.configService.get<string>("CREDIT_CARD_MAX_CATCH_UP_PERIODS");
		const parsed = raw ? Number.parseInt(raw, 10) : NaN;
		return Number.isNaN(parsed) ? DEFAULT_MAX_CATCH_UP_PERIODS : parsed;
	}
}
