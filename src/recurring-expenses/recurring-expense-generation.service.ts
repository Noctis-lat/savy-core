import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { AccountType, Prisma, RecurringExpenseFrequency } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type RecurringExpenseWithProfile = Prisma.RecurringExpenseGetPayload<{
	include: {
		profile: { select: { timezone: true } };
		account: { select: { type: true } };
	};
}>;

/** A calendar date in `YYYY-MM-DD` form, independent of any timezone. */
export type CalendarDate = string;

const DAY_MS = 24 * 60 * 60 * 1000;
const FALLBACK_TIMEZONE = "UTC";
/** Local hour used for generated transaction instants (noon keeps the calendar day stable). */
const BILLING_LOCAL_HOUR = 12;

/** Account types where a positive balance means debt you owe. */
const LIABILITY_TYPES: AccountType[] = ["CREDIT", "LOAN"];

/**
 * Generates EXPENSE transactions from active recurring expenses.
 *
 * Cursor semantics: `lastGeneratedAt` is a real instant meaning "every billing day whose local
 * calendar date is on or before the local date of this instant has been processed". When it
 * is null, processing starts at the local calendar date of `createdAt` (inclusive). The
 * cursor only ever moves forward, so expenses deleted by the user are never recreated.
 *
 * Balance direction: for asset accounts (DEBIT/CASH) an EXPENSE decrements the balance;
 * for liability accounts (CREDIT/LOAN) an EXPENSE increments the balance (more debt).
 */
@Injectable()
export class RecurringExpenseGenerationService {
	private readonly logger = new Logger(RecurringExpenseGenerationService.name);

	constructor(private readonly prisma: PrismaService) {}

	@Cron(CronExpression.EVERY_HOUR)
	async handleCron(): Promise<void> {
		await this.generatePendingExpenses();
	}

	/** Processes every active recurring expense, optionally restricted to one profile. */
	async generatePendingExpenses(profileId?: string, now: Date = new Date()): Promise<number> {
		const expenses = await this.prisma.recurringExpense.findMany({
			where: { isActive: true, ...(profileId ? { profileId } : {}) },
			include: {
				profile: { select: { timezone: true } },
				account: { select: { type: true } },
			},
		});

		let totalTransactions = 0;
		for (const expense of expenses) {
			try {
				totalTransactions += await this.generateForExpense(expense, now);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.logger.error(`Failed to generate expense for source ${expense.id}: ${message}`);
			}
		}

		this.logger.log(
			`Recurring expense generation complete: ${expenses.length} sources processed, ${totalTransactions} transactions created`,
		);
		return totalTransactions;
	}

	/** Convenience entry point to generate pending expenses for a single profile. */
	async generateForProfile(profileId: string, now: Date = new Date()): Promise<number> {
		return this.generatePendingExpenses(profileId, now);
	}

	async generateForExpense(
		expense: RecurringExpenseWithProfile,
		now: Date = new Date(),
	): Promise<number> {
		const timezone = this.resolveTimezone(expense.profile.timezone);
		const today = this.toLocalDate(now, timezone);

		const from = expense.lastGeneratedAt
			? this.addDays(this.toLocalDate(expense.lastGeneratedAt, timezone), 1)
			: this.toLocalDate(expense.createdAt, timezone);

		if (from > today) {
			return 0;
		}

		const createdAtMonth = Number.parseInt(
			this.toLocalDate(expense.createdAt, timezone).slice(5, 7),
			10,
		);

		const billingDays = this.calculateBillingDays(
			expense.frequency,
			expense.billingDays,
			from,
			today,
			createdAtMonth,
		);

		let created = 0;
		let cursor = now;
		for (const billingDay of billingDays) {
			const date = this.localDateTimeToInstant(billingDay, BILLING_LOCAL_HOUR, timezone);
			if (date > cursor) cursor = date;

			const existing = await this.prisma.transaction.findFirst({
				where: { recurringExpenseId: expense.id, date },
				select: { id: true },
			});

			const cursorUpdate = this.prisma.recurringExpense.update({
				where: { id: expense.id },
				data: { lastGeneratedAt: date },
			});

			if (existing) {
				await cursorUpdate;
				continue;
			}

			const isLiability = LIABILITY_TYPES.includes(expense.account.type);
			const balanceOp = isLiability ? "increment" : "decrement";

			await this.prisma.$transaction([
				this.prisma.transaction.create({
					data: {
						accountId: expense.accountId,
						type: "EXPENSE",
						amount: expense.amount,
						categoryId: expense.categoryId ?? null,
						recurringExpenseId: expense.id,
						date,
						description: expense.name,
					},
				}),
				this.prisma.account.update({
					where: { id: expense.accountId },
					data: { balance: { [balanceOp]: expense.amount } },
				}),
				cursorUpdate,
			]);
			created++;
		}

		// Mark today as fully processed so the next run starts tomorrow without rescanning.
		await this.prisma.recurringExpense.update({
			where: { id: expense.id },
			data: { lastGeneratedAt: cursor },
		});

		return created;
	}

	/**
	 * Returns the billing days between `from` and `to` (both inclusive, `YYYY-MM-DD`).
	 * WEEKLY uses weekday 1-7 (1 = Monday); BIWEEKLY/MONTHLY use days of month, where a day
	 * beyond the month length is clamped to the month's last day.
	 * YEARLY uses the month from `createdAt` + the day from `billingDays[0]`.
	 */
	calculateBillingDays(
		frequency: RecurringExpenseFrequency,
		billingDays: number[],
		from: CalendarDate,
		to: CalendarDate,
		createdAtMonth: number,
	): CalendarDate[] {
		const matches = this.buildMatcher(frequency, billingDays, createdAtMonth);
		if (!matches) return [];

		const result: CalendarDate[] = [];
		const end = this.toUtcMs(to);
		for (let cursor = this.toUtcMs(from); cursor <= end; cursor += DAY_MS) {
			const day = new Date(cursor);
			if (matches(day)) {
				result.push(this.formatUtcDate(day));
			}
		}
		return result;
	}

	private buildMatcher(
		frequency: RecurringExpenseFrequency,
		billingDays: number[],
		createdAtMonth: number,
	): ((day: Date) => boolean) | null {
		switch (frequency) {
			case "WEEKLY": {
				const weekday = billingDays[0];
				if (!weekday || weekday < 1 || weekday > 7) return null;
				return (day) => (day.getUTCDay() === 0 ? 7 : day.getUTCDay()) === weekday;
			}
			case "BIWEEKLY": {
				if (billingDays.length < 2) return null;
				const days = billingDays.slice(0, 2);
				return (day) => days.some((d) => this.matchesDayOfMonth(day, d));
			}
			case "MONTHLY": {
				const target = billingDays[0];
				if (!target) return null;
				return (day) => this.matchesDayOfMonth(day, target);
			}
			case "YEARLY": {
				const targetDay = billingDays[0];
				if (!targetDay || targetDay < 1 || targetDay > 31) return null;
				if (createdAtMonth < 1 || createdAtMonth > 12) return null;
				return (day) =>
					day.getUTCMonth() + 1 === createdAtMonth && this.matchesDayOfMonth(day, targetDay);
			}
			default:
				return null;
		}
	}

	private matchesDayOfMonth(day: Date, target: number): boolean {
		if (target < 1 || target > 31) return false;
		const lastDom = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
		return day.getUTCDate() === Math.min(target, lastDom);
	}

	private resolveTimezone(timezone: string | null | undefined): string {
		if (!timezone) return FALLBACK_TIMEZONE;
		try {
			new Intl.DateTimeFormat("en-US", { timeZone: timezone });
			return timezone;
		} catch {
			this.logger.warn(`Invalid timezone "${timezone}", falling back to ${FALLBACK_TIMEZONE}`);
			return FALLBACK_TIMEZONE;
		}
	}

	/** Local calendar date of an instant in the given IANA timezone. */
	private toLocalDate(instant: Date, timezone: string): CalendarDate {
		const parts = this.zonedParts(instant, timezone);
		return this.formatUtcDate(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
	}

	/** Converts a local wall-clock time (date + hour) in `timezone` to a real UTC instant. */
	private localDateTimeToInstant(date: CalendarDate, hour: number, timezone: string): Date {
		const wallClock = this.toUtcMs(date) + hour * 60 * 60 * 1000;
		let instant = wallClock - this.offsetMs(new Date(wallClock), timezone);
		// Second pass corrects for DST transitions between the guess and the result.
		instant = wallClock - this.offsetMs(new Date(instant), timezone);
		return new Date(instant);
	}

	/** Offset of `timezone` from UTC at `instant`, in milliseconds (local - UTC). */
	private offsetMs(instant: Date, timezone: string): number {
		const p = this.zonedParts(instant, timezone);
		const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
		return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
	}

	private zonedParts(
		instant: Date,
		timezone: string,
	): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
		const formatter = new Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		const values: Record<string, number> = {};
		for (const part of formatter.formatToParts(instant)) {
			if (part.type !== "literal") values[part.type] = Number(part.value);
		}
		return {
			year: values.year,
			month: values.month,
			day: values.day,
			hour: values.hour % 24,
			minute: values.minute,
			second: values.second,
		};
	}

	private addDays(date: CalendarDate, days: number): CalendarDate {
		return this.formatUtcDate(new Date(this.toUtcMs(date) + days * DAY_MS));
	}

	private toUtcMs(date: CalendarDate): number {
		return Date.parse(`${date}T00:00:00Z`);
	}

	private formatUtcDate(date: Date): CalendarDate {
		return date.toISOString().slice(0, 10);
	}
}
