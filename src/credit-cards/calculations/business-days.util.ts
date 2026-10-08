/** Pure business-day utilities — no external dependencies. */

/** Returns true if the date falls on Saturday or Sunday. */
export function isWeekend(date: Date): boolean {
	const day = date.getDay();
	return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
}

/** Returns true if the date matches any date in the holiday list (same calendar day). */
export function isHoliday(date: Date, holidays: Date[]): boolean {
	const targetTime = stripTime(date).getTime();
	return holidays.some((h) => stripTime(h).getTime() === targetTime);
}

/**
 * Returns the next business day on or after the given date.
 * If the date is already a business day, returns it unchanged.
 * Skips weekends and holidays, chaining forward until a business day is found.
 */
export function getNextBusinessDay(date: Date, holidays: Date[]): Date {
	const candidate = stripTime(new Date(date));
	while (isWeekend(candidate) || isHoliday(candidate, holidays)) {
		candidate.setDate(candidate.getDate() + 1);
	}
	return candidate;
}

/** Returns a new Date with time components zeroed (midnight local). */
function stripTime(date: Date): Date {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d;
}
