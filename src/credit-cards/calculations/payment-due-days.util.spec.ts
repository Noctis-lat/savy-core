import { calculatePaymentDueDays } from "./payment-due-days.util";

describe("calculatePaymentDueDays", () => {
	it("returns the offset within the same month (cut 5, pay 25 → 20)", () => {
		expect(calculatePaymentDueDays(5, 25, new Date(2026, 0, 1))).toBe(20);
	});

	it("uses the cut date on the reference day itself", () => {
		expect(calculatePaymentDueDays(5, 25, new Date(2026, 0, 5, 18, 30))).toBe(20);
	});

	it("rolls the cut to next month when the reference is past the cut day", () => {
		// Next cut: Feb 5 → pay Feb 25
		expect(calculatePaymentDueDays(5, 25, new Date(2026, 0, 10))).toBe(20);
	});

	it("crosses into next month when paymentDay < cutDay (31-day month)", () => {
		// Jan 15 → Feb 5 = 21 days
		expect(calculatePaymentDueDays(15, 5, new Date(2026, 0, 1))).toBe(21);
	});

	it("crosses into next month when paymentDay < cutDay (30-day month)", () => {
		// Apr 15 → May 5 = 20 days
		expect(calculatePaymentDueDays(15, 5, new Date(2026, 3, 1))).toBe(20);
	});

	it("crosses into next month when paymentDay < cutDay (February)", () => {
		// Feb 15 → Mar 5 = 18 days (2026 is not a leap year)
		expect(calculatePaymentDueDays(15, 5, new Date(2026, 1, 1))).toBe(18);
	});

	it("uses the same day next month when paymentDay === cutDay", () => {
		// Jan 10 → Feb 10 = 31 days
		expect(calculatePaymentDueDays(10, 10, new Date(2026, 0, 1))).toBe(31);
		// Feb 10 → Mar 10 = 28 days
		expect(calculatePaymentDueDays(10, 10, new Date(2026, 1, 1))).toBe(28);
	});

	it("clamps the cut day to the month length", () => {
		// Cut 31 in February → Feb 28; pay 10 → Mar 10 = 10 days
		expect(calculatePaymentDueDays(31, 10, new Date(2026, 1, 1))).toBe(10);
	});

	it("clamps the payment day to the month length", () => {
		// Cut Jan 31 → pay 30 rolls to February, clamped to Feb 28 = 28 days
		expect(calculatePaymentDueDays(31, 30, new Date(2026, 0, 1))).toBe(28);
	});

	it("rolls the payment when the clamped payment date equals the cut date", () => {
		// Cut Feb 28 (clamped 31), pay 30 → clamped Feb 28 is not after cut → Mar 30 = 30 days
		expect(calculatePaymentDueDays(31, 30, new Date(2026, 1, 1))).toBe(30);
	});

	it("handles year boundaries", () => {
		// Dec 20 → Jan 10 = 21 days
		expect(calculatePaymentDueDays(20, 10, new Date(2026, 11, 1))).toBe(21);
	});
});
