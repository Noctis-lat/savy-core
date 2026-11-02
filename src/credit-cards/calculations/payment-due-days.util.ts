/** Pure payment-due-days utilities — no external dependencies. */

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Converts a fixed payment day of the month into a payment-due-days offset (calendar days
 * from the cut date), the model used by `calculatePaymentDueDate(cutDate, paymentDueDays)`.
 *
 * 1. Finds the next cut date on or after `referenceDate` (cut day clamped to month length).
 * 2. Finds the next occurrence of `paymentDay` strictly after that cut date (clamped to
 *    month length). When `paymentDay === cutDay` this is the same day next month.
 * 3. Returns the calendar-day difference between both dates.
 *
 * Examples: cut 5 / pay 25 → 20; cut 15 / pay 5 → 15th to the 5th of next month (20 or 21).
 */
export function calculatePaymentDueDays(
	cutDay: number,
	paymentDay: number,
	referenceDate: Date = new Date(),
): number {
	const reference = stripTime(referenceDate);

	let cutDate = dateInMonth(reference.getFullYear(), reference.getMonth(), cutDay);
	if (cutDate.getTime() < reference.getTime()) {
		cutDate = dateInMonth(reference.getFullYear(), reference.getMonth() + 1, cutDay);
	}

	let paymentDate = dateInMonth(cutDate.getFullYear(), cutDate.getMonth(), paymentDay);
	if (paymentDate.getTime() <= cutDate.getTime()) {
		paymentDate = dateInMonth(cutDate.getFullYear(), cutDate.getMonth() + 1, paymentDay);
	}

	return Math.round((paymentDate.getTime() - cutDate.getTime()) / MS_PER_DAY);
}

/** Builds a local-midnight date for `day` in the given month, clamped to the month length. */
function dateInMonth(year: number, month: number, day: number): Date {
	const firstOfMonth = new Date(year, month, 1);
	const daysInMonth = new Date(
		firstOfMonth.getFullYear(),
		firstOfMonth.getMonth() + 1,
		0,
	).getDate();
	return new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), Math.min(day, daysInMonth));
}

/** Returns a new Date with time components zeroed (midnight local). */
function stripTime(date: Date): Date {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d;
}
