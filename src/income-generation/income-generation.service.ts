import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { IncomeFrequency, Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type IncomeSourceWithProfile = Prisma.IncomeSourceGetPayload<{
	include: { profile: { select: { timezone: true } } };
}>;

/** A calendar date in `YYYY-MM-DD` form, independent of any timezone. */
export type CalendarDate = string;

const DAY_MS = 24 * 60 * 60 * 1000;
const FALLBACK_TIMEZONE = "UTC";
/** Local hour used for generated transaction instants (noon keeps the calendar day stable). */
const PAYDAY_LOCAL_HOUR = 12;

/**
 * Generates INCOME transactions from active income sources.
 *
 * Cursor semantics: `lastGeneratedAt` is a real instant meaning "every payday whose local
 * calendar date is on or before the local date of this instant has been processed". When it
 * is null, processing starts at the local calendar date of `createdAt` (inclusive). The
 * cursor only ever moves forward, so incomes deleted by the user are never recreated.
 */
@Injectable()
export class IncomeGenerationService {
	private readonly logger = new Logger(IncomeGenerationService.name);

	constructor(private readonly prisma: PrismaService) {}

	@Cron(CronExpression.EVERY_HOUR)
	async handleCron(): Promise<void> {
		await this.generatePendingIncomes();
	}

	/** Processes every active income source, optionally restricted to one profile. */
	async generatePendingIncomes(profileId?: string, now: Date = new Date()): Promise<number> {
		const sources = await this.prisma.incomeSource.findMany({
			where: { isActive: true, ...(profileId ? { profileId } : {}) },
			include: { profile: { select: { timezone: true } } },
		});

		let totalTransactions = 0;
		for (const source of sources) {
			try {
				totalTransactions += await this.generateForSource(source, now);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.logger.error(`Failed to generate income for source ${source.id}: ${message}`);
			}
		}

		this.logger.log(
			`Income generation complete: ${sources.length} sources processed, ${totalTransactions} transactions created`,
		);
		return totalTransactions;
	}

	/** Convenience entry point to generate pending incomes for a single profile. */
	async generateForProfile(profileId: string, now: Date = new Date()): Promise<number> {
		return this.generatePendingIncomes(profileId, now);
	}

	async generateForSource(
		source: IncomeSourceWithProfile,
		now: Date = new Date(),
	): Promise<number> {
		const timezone = this.resolveTimezone(source.profile.timezone);
		const today = this.toLocalDate(now, timezone);

		const from = source.lastGeneratedAt
			? this.addDays(this.toLocalDate(source.lastGeneratedAt, timezone), 1)
			: this.toLocalDate(source.createdAt, timezone);

		if (from > today) {
			return 0;
		}

		const paydays = this.calculatePaydays(source.frequency, source.paydays, from, today);

		let created = 0;
		let cursor = now;
		for (const payday of paydays) {
			const date = this.localDateTimeToInstant(payday, PAYDAY_LOCAL_HOUR, timezone);
			if (date > cursor) cursor = date;

			const existing = await this.prisma.transaction.findFirst({
				where: { incomeSourceId: source.id, date },
				select: { id: true },
			});

			const cursorUpdate = this.prisma.incomeSource.update({
				where: { id: source.id },
				data: { lastGeneratedAt: date },
			});

			if (existing) {
				await cursorUpdate;
				continue;
			}

			await this.prisma.$transaction([
				this.prisma.transaction.create({
					data: {
						accountId: source.destinationAccountId,
						type: "INCOME",
						amount: source.amount,
						categoryId: source.categoryId ?? null,
						incomeSourceId: source.id,
						date,
						description: source.name,
					},
				}),
				this.prisma.account.update({
					where: { id: source.destinationAccountId },
					data: { balance: { increment: source.amount } },
				}),
				cursorUpdate,
			]);
			created++;
		}

		// Mark today as fully processed so the next run starts tomorrow without rescanning.
		// `cursor` is never earlier than the last payday instant written above.
		await this.prisma.incomeSource.update({
			where: { id: source.id },
			data: { lastGeneratedAt: cursor },
		});

		return created;
	}

	/**
	 * Returns the paydays between `from` and `to` (both inclusive, `YYYY-MM-DD`).
	 * WEEKLY uses weekday 1-7 (1 = Monday); BIWEEKLY/MONTHLY use days of month, where a day
	 * beyond the month length is clamped to the month's last day.
	 */
	calculatePaydays(
		frequency: IncomeFrequency,
		paydays: number[],
		from: CalendarDate,
		to: CalendarDate,
	): CalendarDate[] {
		const matches = this.buildMatcher(frequency, paydays);
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
		frequency: IncomeFrequency,
		paydays: number[],
	): ((day: Date) => boolean) | null {
		switch (frequency) {
			case "WEEKLY": {
				const weekday = paydays[0];
				if (!weekday || weekday < 1 || weekday > 7) return null;
				return (day) => (day.getUTCDay() === 0 ? 7 : day.getUTCDay()) === weekday;
			}
			case "BIWEEKLY": {
				if (paydays.length < 2) return null;
				const days = paydays.slice(0, 2);
				return (day) => days.some((d) => this.matchesDayOfMonth(day, d));
			}
			case "MONTHLY": {
				const target = paydays[0];
				if (!target) return null;
				return (day) => this.matchesDayOfMonth(day, target);
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
