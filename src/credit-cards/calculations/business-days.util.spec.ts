import { getNextBusinessDay, isHoliday, isWeekend } from "./business-days.util";
import { getMexicanHolidays } from "./mexican-holidays";

describe("business-days.util", () => {
	describe("isWeekend", () => {
		it("Saturday is weekend", () => {
			expect(isWeekend(new Date(2026, 10, 7))).toBe(true); // Sat Nov 7 2026
		});

		it("Sunday is weekend", () => {
			expect(isWeekend(new Date(2026, 10, 8))).toBe(true); // Sun Nov 8 2026
		});

		it("Wednesday is not weekend", () => {
			expect(isWeekend(new Date(2026, 10, 4))).toBe(false); // Wed Nov 4 2026
		});

		it("Monday is not weekend", () => {
			expect(isWeekend(new Date(2026, 10, 2))).toBe(false); // Mon Nov 2 2026
		});
	});

	describe("isHoliday", () => {
		const holidays2026 = getMexicanHolidays(2026);

		it("Sep 16 2026 is not in the list (Independencia observed on third Monday = Sep 21)", () => {
			expect(isHoliday(new Date(2026, 8, 16), holidays2026)).toBe(false);
		});

		it("Sep 21 2026 is a holiday (Independencia observed)", () => {
			expect(isHoliday(new Date(2026, 8, 21), holidays2026)).toBe(true);
		});

		it("Jan 1 2026 is a holiday", () => {
			expect(isHoliday(new Date(2026, 0, 1), holidays2026)).toBe(true);
		});

		it("Nov 4 2026 is not a holiday", () => {
			expect(isHoliday(new Date(2026, 10, 4), holidays2026)).toBe(false);
		});
	});

	describe("getNextBusinessDay", () => {
		const holidays2026 = getMexicanHolidays(2026);

		it("Saturday Nov 7 2026 → Monday Nov 9 2026", () => {
			const result = getNextBusinessDay(new Date(2026, 10, 7), holidays2026);
			expect(result.toDateString()).toBe(new Date(2026, 10, 9).toDateString());
		});

		it("Sunday Nov 8 2026 → Monday Nov 9 2026", () => {
			const result = getNextBusinessDay(new Date(2026, 10, 8), holidays2026);
			expect(result.toDateString()).toBe(new Date(2026, 10, 9).toDateString());
		});

		it("Sep 21 2026 (holiday, Monday) → Sep 22 2026", () => {
			const result = getNextBusinessDay(new Date(2026, 8, 21), holidays2026);
			expect(result.toDateString()).toBe(new Date(2026, 8, 22).toDateString());
		});

		it("Wednesday Nov 4 2026 (business day) → Nov 4 2026 (no adjustment)", () => {
			const result = getNextBusinessDay(new Date(2026, 10, 4), holidays2026);
			expect(result.toDateString()).toBe(new Date(2026, 10, 4).toDateString());
		});

		it("holiday + weekend chain: Friday holiday → next business day (skips Sat+Sun, then skips Sep 21 holiday)", () => {
			// Construct a custom holiday list where Friday Sep 18 2026 is a holiday.
			// Sep 21 2026 is already in getMexicanHolidays (Independencia observed).
			// So Fri Sep 18 (holiday) → Sat Sep 19 → Sun Sep 20 → Mon Sep 21 (holiday) → Tue Sep 22
			const customHolidays = [...holidays2026, new Date(2026, 8, 18)];
			const result = getNextBusinessDay(new Date(2026, 8, 18), customHolidays);
			expect(result.toDateString()).toBe(new Date(2026, 8, 22).toDateString());
		});
	});

	describe("year boundary triangulation", () => {
		it("Jan 1 2027 (holiday, Friday) → Jan 4 2027 (Monday, skipping Sat+Sun)", () => {
			const holidays2027 = getMexicanHolidays(2027);
			const result = getNextBusinessDay(new Date(2027, 0, 1), holidays2027);
			expect(result.toDateString()).toBe(new Date(2027, 0, 4).toDateString());
		});
	});
});
