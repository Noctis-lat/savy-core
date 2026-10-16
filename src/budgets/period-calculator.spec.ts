import { computePeriodRange, computePreviousPeriodRange } from "./period-calculator";

// All dates use UTC to avoid timezone drift in tests.

function utc(
	year: number,
	month: number,
	day: number,
	hours = 0,
	minutes = 0,
	seconds = 0,
	ms = 0,
): Date {
	return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds, ms));
}

// ─── ONE_TIME ──────────────────────────────────────────────────────────

describe("computePeriodRange — ONE_TIME", () => {
	it("returns the full date range from startDate to endDate", () => {
		const result = computePeriodRange(
			"ONE_TIME",
			null,
			utc(2026, 1, 1),
			utc(2026, 12, 31),
			utc(2026, 6, 15),
		);
		expect(result.start).toEqual(utc(2026, 1, 1));
		expect(result.end).toEqual(utc(2026, 12, 31));
	});

	it("throws if endDate is null for ONE_TIME", () => {
		expect(() =>
			computePeriodRange("ONE_TIME", null, utc(2026, 1, 1), null, utc(2026, 6, 15)),
		).toThrow("ONE_TIME budget requires endDate");
	});

	it("returns the range even if now is before startDate", () => {
		const result = computePeriodRange(
			"ONE_TIME",
			null,
			utc(2026, 6, 1),
			utc(2026, 12, 31),
			utc(2026, 1, 1),
		);
		expect(result.start).toEqual(utc(2026, 6, 1));
		expect(result.end).toEqual(utc(2026, 12, 31));
	});
});

// ─── WEEKLY ────────────────────────────────────────────────────────────

describe("computePeriodRange — WEEKLY", () => {
	it("finds the current 7-day block for a normal past startDate", () => {
		// startDate = Jan 1, now = Jan 16 → elapsed 15 days → 2 full cycles → period [Jan 15, Jan 21 23:59:59.999]
		const result = computePeriodRange(
			"RECURRING",
			"WEEKLY",
			utc(2026, 1, 1),
			null,
			utc(2026, 1, 16),
		);
		expect(result.start).toEqual(utc(2026, 1, 15));
		expect(result.end).toEqual(utc(2026, 1, 21, 23, 59, 59, 999));
	});

	it("returns the first block when now is exactly on a boundary", () => {
		// startDate = Jan 1, now = Jan 8 exactly → elapsed 7 days → 1 cycle → period [Jan 8, Jan 14 23:59:59.999]
		const result = computePeriodRange(
			"RECURRING",
			"WEEKLY",
			utc(2026, 1, 1),
			null,
			utc(2026, 1, 8),
		);
		expect(result.start).toEqual(utc(2026, 1, 8));
		expect(result.end).toEqual(utc(2026, 1, 14, 23, 59, 59, 999));
	});

	it("returns the first period when startDate equals now", () => {
		const result = computePeriodRange(
			"RECURRING",
			"WEEKLY",
			utc(2026, 1, 1),
			null,
			utc(2026, 1, 1),
		);
		expect(result.start).toEqual(utc(2026, 1, 1));
		expect(result.end).toEqual(utc(2026, 1, 7, 23, 59, 59, 999));
	});

	it("returns the first period when startDate is in the future", () => {
		const result = computePeriodRange(
			"RECURRING",
			"WEEKLY",
			utc(2026, 6, 1),
			null,
			utc(2026, 1, 1),
		);
		expect(result.start).toEqual(utc(2026, 6, 1));
		expect(result.end).toEqual(utc(2026, 6, 7, 23, 59, 59, 999));
	});
});

// ─── BIWEEKLY ──────────────────────────────────────────────────────────

describe("computePeriodRange — BIWEEKLY", () => {
	it("finds the current 14-day block for a normal past startDate", () => {
		// startDate = Jan 1, now = Jan 31 → elapsed 30 days → 2 full cycles → period [Jan 29, Feb 11 23:59:59.999]
		const result = computePeriodRange(
			"RECURRING",
			"BIWEEKLY",
			utc(2026, 1, 1),
			null,
			utc(2026, 1, 31),
		);
		expect(result.start).toEqual(utc(2026, 1, 29));
		expect(result.end).toEqual(utc(2026, 2, 11, 23, 59, 59, 999));
	});

	it("returns the first block when now is exactly on a boundary", () => {
		// startDate = Jan 1, now = Jan 15 exactly → elapsed 14 days → 1 cycle
		const result = computePeriodRange(
			"RECURRING",
			"BIWEEKLY",
			utc(2026, 1, 1),
			null,
			utc(2026, 1, 15),
		);
		expect(result.start).toEqual(utc(2026, 1, 15));
		expect(result.end).toEqual(utc(2026, 1, 28, 23, 59, 59, 999));
	});
});

// ─── MONTHLY ───────────────────────────────────────────────────────────

describe("computePeriodRange — MONTHLY", () => {
	it("finds the current month-anchored period for a normal date", () => {
		// startDate = Jan 15, now = Mar 1 → current period [Feb 15, Mar 14 23:59:59.999]
		const result = computePeriodRange(
			"RECURRING",
			"MONTHLY",
			utc(2026, 1, 15),
			null,
			utc(2026, 3, 1),
		);
		expect(result.start).toEqual(utc(2026, 2, 15));
		expect(result.end).toEqual(utc(2026, 3, 14, 23, 59, 59, 999));
	});

	it("anchors on day 1 of the month", () => {
		const result = computePeriodRange(
			"RECURRING",
			"MONTHLY",
			utc(2026, 1, 1),
			null,
			utc(2026, 3, 15),
		);
		expect(result.start).toEqual(utc(2026, 3, 1));
		expect(result.end).toEqual(utc(2026, 3, 31, 23, 59, 59, 999));
	});

	it("clamps day 31 to Feb 28 (non-leap year)", () => {
		// startDate = Jan 31, now = Mar 1 → Feb 28 (clamped), end = Mar 28... wait
		// Previous period start candidates:
		//   Mar 31 → clamped to Mar 31 → Mar 31 > Mar 1 → walk back
		//   Feb 28 (31 clamped) → Feb 28 <= Mar 1 → current period start = Feb 28
		//   Next period start: Mar 31 → end = Mar 30 23:59:59.999
		const result = computePeriodRange(
			"RECURRING",
			"MONTHLY",
			utc(2026, 1, 31),
			null,
			utc(2026, 3, 1),
		);
		expect(result.start).toEqual(utc(2026, 2, 28));
		expect(result.end).toEqual(utc(2026, 3, 30, 23, 59, 59, 999));
	});

	it("clamps day 31 to Apr 30", () => {
		// startDate = Jan 31, now = Apr 15 → Mar 31 (not clamped, March has 31 days)
		// Mar 31 <= Apr 15 → current period start = Mar 31
		// Next: Apr 31 → clamped to Apr 30 → end = Apr 29 23:59:59.999
		const result = computePeriodRange(
			"RECURRING",
			"MONTHLY",
			utc(2026, 1, 31),
			null,
			utc(2026, 4, 15),
		);
		expect(result.start).toEqual(utc(2026, 3, 31));
		expect(result.end).toEqual(utc(2026, 4, 29, 23, 59, 59, 999));
	});

	it("clamps day 30 to Feb 28 (non-leap year)", () => {
		// startDate = Jan 30, now = Mar 15 → Feb 28 (clamped), next = Mar 30
		// Feb 28 <= Mar 15 → current period = Feb 28
		// Next: Mar 30 → end = Mar 29 23:59:59.999
		const result = computePeriodRange(
			"RECURRING",
			"MONTHLY",
			utc(2026, 1, 30),
			null,
			utc(2026, 3, 15),
		);
		expect(result.start).toEqual(utc(2026, 2, 28));
		expect(result.end).toEqual(utc(2026, 3, 29, 23, 59, 59, 999));
	});

	it("clamps day 29 to Feb 28 (non-leap year)", () => {
		// startDate = Jan 29, now = Mar 15 → Feb 28 (clamped), next = Mar 29
		const result = computePeriodRange(
			"RECURRING",
			"MONTHLY",
			utc(2026, 1, 29),
			null,
			utc(2026, 3, 15),
		);
		expect(result.start).toEqual(utc(2026, 2, 28));
		expect(result.end).toEqual(utc(2026, 3, 28, 23, 59, 59, 999));
	});

	it("keeps day 29 in Feb during a leap year", () => {
		// 2028 is a leap year. startDate = Jan 29, now = Mar 15
		// Feb 29 exists → Feb 29 <= Mar 15 → current period = Feb 29
		// Next: Mar 29 → end = Mar 28 23:59:59.999
		const result = computePeriodRange(
			"RECURRING",
			"MONTHLY",
			utc(2028, 1, 29),
			null,
			utc(2028, 3, 15),
		);
		expect(result.start).toEqual(utc(2028, 2, 29));
		expect(result.end).toEqual(utc(2028, 3, 28, 23, 59, 59, 999));
	});

	it("handles day 31 in a month with 30 days (April)", () => {
		// startDate = Mar 31, now = May 15 → Apr 30 (clamped), next = May 31
		// Apr 30 <= May 15 → current period = Apr 30
		// Next: May 31 → end = May 30 23:59:59.999
		const result = computePeriodRange(
			"RECURRING",
			"MONTHLY",
			utc(2026, 3, 31),
			null,
			utc(2026, 5, 15),
		);
		expect(result.start).toEqual(utc(2026, 4, 30));
		expect(result.end).toEqual(utc(2026, 5, 30, 23, 59, 59, 999));
	});

	it("handles day 31 in June (30 days)", () => {
		// startDate = May 31, now = Jul 15 → Jun 30 (clamped), next = Jul 31
		const result = computePeriodRange(
			"RECURRING",
			"MONTHLY",
			utc(2026, 5, 31),
			null,
			utc(2026, 7, 15),
		);
		expect(result.start).toEqual(utc(2026, 6, 30));
		expect(result.end).toEqual(utc(2026, 7, 30, 23, 59, 59, 999));
	});

	it("handles day 31 in September (30 days)", () => {
		// startDate = Aug 31, now = Oct 15 → Sep 30 (clamped), next = Oct 31
		const result = computePeriodRange(
			"RECURRING",
			"MONTHLY",
			utc(2026, 8, 31),
			null,
			utc(2026, 10, 15),
		);
		expect(result.start).toEqual(utc(2026, 9, 30));
		expect(result.end).toEqual(utc(2026, 10, 30, 23, 59, 59, 999));
	});

	it("handles day 31 in November (30 days)", () => {
		// startDate = Oct 31, now = Dec 15 → Nov 30 (clamped), next = Dec 31
		const result = computePeriodRange(
			"RECURRING",
			"MONTHLY",
			utc(2026, 10, 31),
			null,
			utc(2026, 12, 15),
		);
		expect(result.start).toEqual(utc(2026, 11, 30));
		expect(result.end).toEqual(utc(2026, 12, 30, 23, 59, 59, 999));
	});

	it("returns the first period when startDate is in the future", () => {
		const result = computePeriodRange(
			"RECURRING",
			"MONTHLY",
			utc(2026, 6, 15),
			null,
			utc(2026, 1, 1),
		);
		expect(result.start).toEqual(utc(2026, 6, 15));
		// Next: Jul 15 → end = Jul 14 23:59:59.999
		expect(result.end).toEqual(utc(2026, 7, 14, 23, 59, 59, 999));
	});

	it("returns the first period when startDate equals now", () => {
		const result = computePeriodRange(
			"RECURRING",
			"MONTHLY",
			utc(2026, 1, 15),
			null,
			utc(2026, 1, 15),
		);
		expect(result.start).toEqual(utc(2026, 1, 15));
		expect(result.end).toEqual(utc(2026, 2, 14, 23, 59, 59, 999));
	});
});

// ─── YEARLY ────────────────────────────────────────────────────────────

describe("computePeriodRange — YEARLY", () => {
	it("finds the current year-anchored period for a normal date", () => {
		// startDate = Mar 15, 2024, now = Jun 1, 2026 → current period [Mar 15, 2026, Mar 14, 2027 23:59:59.999]
		const result = computePeriodRange(
			"RECURRING",
			"YEARLY",
			utc(2024, 3, 15),
			null,
			utc(2026, 6, 1),
		);
		expect(result.start).toEqual(utc(2026, 3, 15));
		expect(result.end).toEqual(utc(2027, 3, 14, 23, 59, 59, 999));
	});

	it("goes to previous year when now is before the anchor month+day", () => {
		// startDate = Mar 15, 2024, now = Jan 1, 2026 → anchor hasn't passed yet → [Mar 15, 2025, Mar 14, 2026]
		const result = computePeriodRange(
			"RECURRING",
			"YEARLY",
			utc(2024, 3, 15),
			null,
			utc(2026, 1, 1),
		);
		expect(result.start).toEqual(utc(2025, 3, 15));
		expect(result.end).toEqual(utc(2026, 3, 14, 23, 59, 59, 999));
	});

	it("clamps Feb 29 anchor to Feb 28 in non-leap years", () => {
		// startDate = Feb 29, 2024 (leap), now = Jun 1, 2026 (non-leap)
		// 2026 anchor: Feb 28 (clamped) → Feb 28 <= Jun 1 → current period [Feb 28, 2026, Feb 27, 2027 23:59:59.999]
		// Wait: next year 2027 also non-leap → Feb 28 → end = Feb 27 23:59:59.999
		const result = computePeriodRange(
			"RECURRING",
			"YEARLY",
			utc(2024, 2, 29),
			null,
			utc(2026, 6, 1),
		);
		expect(result.start).toEqual(utc(2026, 2, 28));
		expect(result.end).toEqual(utc(2027, 2, 27, 23, 59, 59, 999));
	});

	it("keeps Feb 29 anchor in leap year", () => {
		// startDate = Feb 29, 2024, now = Jun 1, 2028 (leap year)
		// 2028 anchor: Feb 29 (leap) → Feb 29 <= Jun 1 → current period [Feb 29, 2028, Feb 28, 2029 23:59:59.999]
		// 2029 is non-leap → Feb 28 → end = Feb 27 23:59:59.999
		const result = computePeriodRange(
			"RECURRING",
			"YEARLY",
			utc(2024, 2, 29),
			null,
			utc(2028, 6, 1),
		);
		expect(result.start).toEqual(utc(2028, 2, 29));
		expect(result.end).toEqual(utc(2029, 2, 27, 23, 59, 59, 999));
	});

	it("returns the first period when startDate is in the future", () => {
		const result = computePeriodRange(
			"RECURRING",
			"YEARLY",
			utc(2027, 3, 15),
			null,
			utc(2026, 1, 1),
		);
		expect(result.start).toEqual(utc(2027, 3, 15));
		expect(result.end).toEqual(utc(2028, 3, 14, 23, 59, 59, 999));
	});

	it("returns the first period when startDate equals now", () => {
		const result = computePeriodRange(
			"RECURRING",
			"YEARLY",
			utc(2026, 3, 15),
			null,
			utc(2026, 3, 15),
		);
		expect(result.start).toEqual(utc(2026, 3, 15));
		expect(result.end).toEqual(utc(2027, 3, 14, 23, 59, 59, 999));
	});
});

// ─── computePreviousPeriodRange ────────────────────────────────────────

describe("computePreviousPeriodRange", () => {
	it("returns null when current period is the first period (WEEKLY)", () => {
		const prev = computePreviousPeriodRange(
			"RECURRING",
			"WEEKLY",
			utc(2026, 1, 1),
			null,
			utc(2026, 1, 3),
		);
		expect(prev).toBeNull();
	});

	it("returns the previous 7-day block (WEEKLY)", () => {
		const prev = computePreviousPeriodRange(
			"RECURRING",
			"WEEKLY",
			utc(2026, 1, 1),
			null,
			utc(2026, 1, 16),
		);
		// Current period starts Jan 15, previous = [Jan 8, Jan 14 23:59:59.999]
		expect(prev).not.toBeNull();
		expect(prev!.start).toEqual(utc(2026, 1, 8));
		expect(prev!.end).toEqual(utc(2026, 1, 14, 23, 59, 59, 999));
	});

	it("returns the previous month (MONTHLY)", () => {
		const prev = computePreviousPeriodRange(
			"RECURRING",
			"MONTHLY",
			utc(2026, 1, 15),
			null,
			utc(2026, 3, 1),
		);
		// Current period starts Feb 15, previous = [Jan 15, Feb 14 23:59:59.999]
		expect(prev).not.toBeNull();
		expect(prev!.start).toEqual(utc(2026, 1, 15));
		expect(prev!.end).toEqual(utc(2026, 2, 14, 23, 59, 59, 999));
	});

	it("returns null when current period is the first (MONTHLY)", () => {
		const prev = computePreviousPeriodRange(
			"RECURRING",
			"MONTHLY",
			utc(2026, 1, 15),
			null,
			utc(2026, 1, 20),
		);
		expect(prev).toBeNull();
	});

	it("returns null for ONE_TIME", () => {
		const prev = computePreviousPeriodRange(
			"ONE_TIME",
			null,
			utc(2026, 1, 1),
			utc(2026, 12, 31),
			utc(2026, 6, 15),
		);
		expect(prev).toBeNull();
	});

	it("clamps day 31 correctly in previous period (MONTHLY)", () => {
		// startDate = Jan 31, now = Apr 15 → current = [Mar 31, Apr 29 23:59:59.999]
		// Previous = [Feb 28 (clamped), Mar 30 23:59:59.999]
		const prev = computePreviousPeriodRange(
			"RECURRING",
			"MONTHLY",
			utc(2026, 1, 31),
			null,
			utc(2026, 4, 15),
		);
		expect(prev).not.toBeNull();
		expect(prev!.start).toEqual(utc(2026, 2, 28));
		expect(prev!.end).toEqual(utc(2026, 3, 30, 23, 59, 59, 999));
	});

	it("returns the previous year (YEARLY)", () => {
		const prev = computePreviousPeriodRange(
			"RECURRING",
			"YEARLY",
			utc(2024, 3, 15),
			null,
			utc(2026, 6, 1),
		);
		// Current period starts Mar 15, 2026 → previous = [Mar 15, 2025, Mar 14, 2026 23:59:59.999]
		expect(prev).not.toBeNull();
		expect(prev!.start).toEqual(utc(2025, 3, 15));
		expect(prev!.end).toEqual(utc(2026, 3, 14, 23, 59, 59, 999));
	});
});
