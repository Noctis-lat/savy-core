import type { BudgetKind, BudgetPeriod } from "../generated/prisma/client";

export interface PeriodRange {
	start: Date;
	end: Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;
const MS_PER_BIWEEK = 14 * MS_PER_DAY;

/**
 * Compute the current period range for a budget.
 *
 * - ONE_TIME: returns { start: startDate, end: endDate } (endDate required).
 * - WEEKLY / BIWEEKLY: rolling N-day blocks from startDate.
 * - MONTHLY: anchored to the day-of-month of startDate, clamped to month end.
 * - YEARLY: anchored to the month+day of startDate, Feb 29 clamps to Feb 28 in non-leap years.
 *
 * The period END is the period START of the NEXT period minus 1 millisecond.
 *
 * If startDate is in the future, the first period (start = startDate) is returned.
 */
export function computePeriodRange(
	kind: BudgetKind,
	period: BudgetPeriod | null,
	startDate: Date,
	endDate: Date | null,
	now: Date,
): PeriodRange {
	if (kind === "ONE_TIME") {
		if (!endDate) {
			throw new Error("ONE_TIME budget requires endDate");
		}
		return { start: new Date(startDate), end: new Date(endDate) };
	}

	if (period === null) {
		throw new Error("RECURRING budget requires a non-null period");
	}

	if (now.getTime() < startDate.getTime()) {
		// Future start: return the first period
		return firstPeriod(startDate, period);
	}

	switch (period) {
		case "WEEKLY":
			return rollingPeriod(startDate, now, MS_PER_WEEK);
		case "BIWEEKLY":
			return rollingPeriod(startDate, now, MS_PER_BIWEEK);
		case "MONTHLY":
			return monthlyPeriod(startDate, now);
		case "YEARLY":
			return yearlyPeriod(startDate, now);
		default: {
			const _exhaustive: never = period;
			throw new Error(`Unsupported period: ${String(_exhaustive)}`);
		}
	}
}

/**
 * Compute the period that immediately precedes the current period.
 * Returns null if there is no previous period (e.g. startDate is in the future
 * or the current period IS the first period).
 */
export function computePreviousPeriodRange(
	kind: BudgetKind,
	period: BudgetPeriod | null,
	startDate: Date,
	endDate: Date | null,
	now: Date,
): PeriodRange | null {
	const current = computePeriodRange(kind, period, startDate, endDate, now);

	if (current.start.getTime() <= startDate.getTime()) {
		return null;
	}

	if (kind === "ONE_TIME") {
		return null;
	}

	if (period === null) {
		throw new Error("RECURRING budget requires a non-null period");
	}

	switch (period) {
		case "WEEKLY":
			return {
				start: new Date(current.start.getTime() - MS_PER_WEEK),
				end: new Date(current.start.getTime() - 1),
			};
		case "BIWEEKLY":
			return {
				start: new Date(current.start.getTime() - MS_PER_BIWEEK),
				end: new Date(current.start.getTime() - 1),
			};
		case "MONTHLY":
			return monthlyPreviousPeriod(startDate, current.start);
		case "YEARLY":
			return yearlyPreviousPeriod(startDate, current.start);
		default: {
			const _exhaustive: never = period;
			throw new Error(`Unsupported period: ${String(_exhaustive)}`);
		}
	}
}

// ─── Helpers ───────────────────────────────────────────────────────────

function firstPeriod(startDate: Date, period: BudgetPeriod): PeriodRange {
	switch (period) {
		case "WEEKLY":
			return {
				start: new Date(startDate),
				end: new Date(startDate.getTime() + MS_PER_WEEK - 1),
			};
		case "BIWEEKLY":
			return {
				start: new Date(startDate),
				end: new Date(startDate.getTime() + MS_PER_BIWEEK - 1),
			};
		case "MONTHLY":
			return monthlyFirstPeriod(startDate);
		case "YEARLY":
			return yearlyFirstPeriod(startDate);
		default: {
			const _exhaustive: never = period;
			throw new Error(`Unsupported period: ${String(_exhaustive)}`);
		}
	}
}

function rollingPeriod(startDate: Date, now: Date, durationMs: number): PeriodRange {
	const elapsed = now.getTime() - startDate.getTime();
	const cyclesPassed = Math.floor(elapsed / durationMs);
	const start = new Date(startDate.getTime() + cyclesPassed * durationMs);
	const end = new Date(start.getTime() + durationMs - 1);
	return { start, end };
}

// ─── Monthly ───────────────────────────────────────────────────────────

/** Clamp a day-of-month to the actual last day of a given year/month. */
function clampDayToMonth(year: number, month: number, day: number): number {
	// month is 0-based for Date.UTC but we pass 1-based to this helper
	const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
	return Math.min(day, lastDay);
}

/**
 * Monthly periods are anchored to the day-of-month of startDate.
 * Day 29/30/31 clamp to month end in short months.
 *
 * Algorithm: walk backwards month by month from "now" until the anchor day
 * produces a start <= now.
 */
function monthlyPeriod(startDate: Date, now: Date): PeriodRange {
	const anchorDay = startDate.getUTCDate();

	// Try the current month, then walk backwards
	let year = now.getUTCFullYear();
	let month = now.getUTCMonth(); // 0-based

	// Walk back until we find a period start <= now
	for (;;) {
		const clampedDay = clampDayToMonth(year, month + 1, anchorDay);
		const candidateStart = Date.UTC(year, month, clampedDay);
		if (candidateStart <= now.getTime()) {
			// Found the current period start
			const start = new Date(candidateStart);
			// Next period start: one month forward, clamp again
			const nextMonth = month + 1;
			const nextYear = nextMonth > 11 ? year + 1 : year;
			const nextMonthIdx = nextMonth > 11 ? 0 : nextMonth;
			const nextClampedDay = clampDayToMonth(nextYear, nextMonthIdx + 1, anchorDay);
			const nextStart = Date.UTC(nextYear, nextMonthIdx, nextClampedDay);
			const end = new Date(nextStart - 1);
			return { start, end };
		}
		// Move back one month
		month -= 1;
		if (month < 0) {
			month = 11;
			year -= 1;
		}
		// Safety: don't go before startDate
		if (year < startDate.getUTCFullYear() || (year === startDate.getUTCFullYear() && month < startDate.getUTCMonth())) {
			// Fallback to first period
			return monthlyFirstPeriod(startDate);
		}
	}
}

function monthlyFirstPeriod(startDate: Date): PeriodRange {
	const start = new Date(startDate);
	const anchorDay = startDate.getUTCDate();
	const nextMonth = startDate.getUTCMonth() + 1;
	const nextYear = nextMonth > 11 ? startDate.getUTCFullYear() + 1 : startDate.getUTCFullYear();
	const nextMonthIdx = nextMonth > 11 ? 0 : nextMonth;
	const nextClampedDay = clampDayToMonth(nextYear, nextMonthIdx + 1, anchorDay);
	const nextStart = Date.UTC(nextYear, nextMonthIdx, nextClampedDay);
	const end = new Date(nextStart - 1);
	return { start, end };
}

function monthlyPreviousPeriod(startDate: Date, currentStart: Date): PeriodRange | null {
	const anchorDay = startDate.getUTCDate();
	const year = currentStart.getUTCFullYear();
	const month = currentStart.getUTCMonth();

	// Previous month
	let prevMonth = month - 1;
	let prevYear = year;
	if (prevMonth < 0) {
		prevMonth = 11;
		prevYear -= 1;
	}

	// Safety: don't go before startDate
	const prevClampedDay = clampDayToMonth(prevYear, prevMonth + 1, anchorDay);
	const prevStartMs = Date.UTC(prevYear, prevMonth, prevClampedDay);
	if (prevStartMs < startDate.getTime()) {
		return null;
	}

	return {
		start: new Date(prevStartMs),
		end: new Date(currentStart.getTime() - 1),
	};
}

// ─── Yearly ────────────────────────────────────────────────────────────

/**
 * Is the given year a leap year?
 */
function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Clamp the anchor month+day for yearly periods.
 * Feb 29 clamps to Feb 28 in non-leap years.
 */
function clampYearlyAnchor(year: number, month: number, day: number): { month: number; day: number } {
	if (month === 1 && day === 29 && !isLeapYear(year)) {
		return { month: 1, day: 28 };
	}
	return { month, day };
}

/**
 * Yearly periods are anchored to the month+day of startDate.
 * Feb 29 clamps to Feb 28 in non-leap years.
 */
function yearlyPeriod(startDate: Date, now: Date): PeriodRange {
	const anchorMonth = startDate.getUTCMonth();
	const anchorDay = startDate.getUTCDate();

	let year = now.getUTCFullYear();

	// Check if this year's anchor has passed
	const clamped = clampYearlyAnchor(year, anchorMonth, anchorDay);
	const candidateStart = Date.UTC(year, clamped.month, clamped.day);

	if (candidateStart > now.getTime()) {
		year -= 1;
	}

	// Safety: don't go before startDate
	const startYear = Math.max(year, startDate.getUTCFullYear());
	const startClamped = clampYearlyAnchor(startYear, anchorMonth, anchorDay);
	const startMs = Date.UTC(startYear, startClamped.month, startClamped.day);

	if (startMs < startDate.getTime()) {
		return yearlyFirstPeriod(startDate);
	}

	const start = new Date(startMs);
	const nextYear = startYear + 1;
	const nextClamped = clampYearlyAnchor(nextYear, anchorMonth, anchorDay);
	const nextStart = Date.UTC(nextYear, nextClamped.month, nextClamped.day);
	const end = new Date(nextStart - 1);
	return { start, end };
}

function yearlyFirstPeriod(startDate: Date): PeriodRange {
	const start = new Date(startDate);
	const anchorMonth = startDate.getUTCMonth();
	const anchorDay = startDate.getUTCDate();
	const nextYear = startDate.getUTCFullYear() + 1;
	const nextClamped = clampYearlyAnchor(nextYear, anchorMonth, anchorDay);
	const nextStart = Date.UTC(nextYear, nextClamped.month, nextClamped.day);
	const end = new Date(nextStart - 1);
	return { start, end };
}

function yearlyPreviousPeriod(startDate: Date, currentStart: Date): PeriodRange | null {
	const anchorMonth = startDate.getUTCMonth();
	const anchorDay = startDate.getUTCDate();
	const year = currentStart.getUTCFullYear();

	const prevYear = year - 1;
	const prevClamped = clampYearlyAnchor(prevYear, anchorMonth, anchorDay);
	const prevStartMs = Date.UTC(prevYear, prevClamped.month, prevClamped.day);

	if (prevStartMs < startDate.getTime()) {
		return null;
	}

	return {
		start: new Date(prevStartMs),
		end: new Date(currentStart.getTime() - 1),
	};
}