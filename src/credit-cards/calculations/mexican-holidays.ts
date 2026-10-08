/**
 * Mexican national holidays — pure computation, no I/O.
 *
 * Fixed holidays: January 1, May 1, December 25.
 * Movable holidays (observed per 2006 reform):
 *   - Constitución (Feb 5): first Monday of February
 *   - Benito Juárez (Mar 21): third Monday of March
 *   - Independencia (Sep 16): third Monday of September
 *   - Revolución (Nov 20): third Monday of November
 */

/** Returns the first Monday of the given month (0-indexed) for the given year. */
function getFirstMondayOfMonth(year: number, month: number): Date {
	const firstDay = new Date(year, month, 1);
	const dayOfWeek = firstDay.getDay(); // 0 = Sunday
	const daysUntilMonday = (8 - dayOfWeek) % 7; // 0 if 1st is Monday, else 1-6
	return new Date(year, month, 1 + daysUntilMonday);
}

/** Returns the third Monday of the given month (0-indexed) for the given year. */
function getThirdMondayOfMonth(year: number, month: number): Date {
	const firstMonday = getFirstMondayOfMonth(year, month);
	return new Date(year, month, firstMonday.getDate() + 14); // +14 days = 3rd Monday
}

export function getMexicanHolidays(year: number): Date[] {
	return [
		new Date(year, 0, 1), // Jan 1 — Año Nuevo
		getFirstMondayOfMonth(year, 1), // Feb — Constitución (first Monday)
		getThirdMondayOfMonth(year, 2), // Mar — Benito Juárez (third Monday)
		new Date(year, 4, 1), // May 1 — Día del Trabajo
		getThirdMondayOfMonth(year, 8), // Sep — Independencia (third Monday)
		getThirdMondayOfMonth(year, 10), // Nov — Revolución (third Monday)
		new Date(year, 11, 25), // Dec 25 — Navidad
	];
}
