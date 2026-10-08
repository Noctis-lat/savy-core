import { getMexicanHolidays } from "./mexican-holidays";

describe("getMexicanHolidays", () => {
	describe("2026 fixed holidays", () => {
		const holidays = getMexicanHolidays(2026);

		it("includes January 1 (Año Nuevo)", () => {
			const jan1 = new Date(2026, 0, 1);
			expect(holidays.some((h) => h.getTime() === jan1.getTime())).toBe(true);
		});

		it("includes May 1 (Día del Trabajo)", () => {
			const may1 = new Date(2026, 4, 1);
			expect(holidays.some((h) => h.getTime() === may1.getTime())).toBe(true);
		});

		it("includes December 25 (Navidad)", () => {
			const dec25 = new Date(2026, 11, 25);
			expect(holidays.some((h) => h.getTime() === dec25.getTime())).toBe(true);
		});
	});

	describe("2026 movable holidays (observed on Monday)", () => {
		const holidays = getMexicanHolidays(2026);

		it("Constitución: first Monday of February 2026 (Feb 2)", () => {
			const feb2 = new Date(2026, 1, 2);
			expect(holidays.some((h) => h.getTime() === feb2.getTime())).toBe(true);
		});

		it("Benito Juárez: third Monday of March 2026 (Mar 16)", () => {
			const mar16 = new Date(2026, 2, 16);
			expect(holidays.some((h) => h.getTime() === mar16.getTime())).toBe(true);
		});

		it("Independencia: third Monday of September 2026 (Sep 21)", () => {
			const sep21 = new Date(2026, 8, 21);
			expect(holidays.some((h) => h.getTime() === sep21.getTime())).toBe(true);
		});

		it("Revolución: third Monday of November 2026 (Nov 16)", () => {
			const nov16 = new Date(2026, 10, 16);
			expect(holidays.some((h) => h.getTime() === nov16.getTime())).toBe(true);
		});
	});

	describe("returns 7 holidays total", () => {
		it("returns exactly 7 holidays for 2026", () => {
			expect(getMexicanHolidays(2026)).toHaveLength(7);
		});
	});

	describe("2027 triangulation", () => {
		const holidays = getMexicanHolidays(2027);

		it("includes January 1, 2027", () => {
			const jan1 = new Date(2027, 0, 1);
			expect(holidays.some((h) => h.getTime() === jan1.getTime())).toBe(true);
		});

		it("Constitución: first Monday of February 2027 (Feb 1)", () => {
			const feb1 = new Date(2027, 1, 1);
			expect(holidays.some((h) => h.getTime() === feb1.getTime())).toBe(true);
		});

		it("Benito Juárez: third Monday of March 2027 (Mar 15)", () => {
			const mar15 = new Date(2027, 2, 15);
			expect(holidays.some((h) => h.getTime() === mar15.getTime())).toBe(true);
		});

		it("Independencia: third Monday of September 2027 (Sep 20)", () => {
			const sep20 = new Date(2027, 8, 20);
			expect(holidays.some((h) => h.getTime() === sep20.getTime())).toBe(true);
		});

		it("Revolución: third Monday of November 2027 (Nov 15)", () => {
			const nov15 = new Date(2027, 10, 15);
			expect(holidays.some((h) => h.getTime() === nov15.getTime())).toBe(true);
		});

		it("includes December 25, 2027", () => {
			const dec25 = new Date(2027, 11, 25);
			expect(holidays.some((h) => h.getTime() === dec25.getTime())).toBe(true);
		});

		it("returns exactly 7 holidays for 2027", () => {
			expect(holidays).toHaveLength(7);
		});
	});
});
