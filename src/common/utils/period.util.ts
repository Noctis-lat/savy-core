import { SPANISH_MONTHS } from "./date-labels";

export const PERIODS = [
	"day",
	"week",
	"month",
	"other_month",
	"quarter",
	"semester",
	"year",
] as const;

export type Period = (typeof PERIODS)[number];

export interface PeriodRange {
	start: Date;
	end: Date;
	label: string;
	periodLabel: string;
}

export function computePeriodRange(period: string): PeriodRange {
	const now = new Date();
	const year = now.getUTCFullYear();
	const month = now.getUTCMonth();

	const monthLabel = (y: number, m: number): string => `${SPANISH_MONTHS[m]} ${y}`;

	switch (period) {
		case "day": {
			const start = new Date(Date.UTC(year, month, now.getUTCDate()));
			const end = new Date(Date.UTC(year, month, now.getUTCDate(), 23, 59, 59, 999));
			return {
				start,
				end,
				label: `${year}-${String(month + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`,
				periodLabel: monthLabel(year, month),
			};
		}
		case "week": {
			const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
			return {
				start,
				end: now,
				label: `${year}-${String(month + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`,
				periodLabel: "Últimos 7 días",
			};
		}
		case "month": {
			const start = new Date(Date.UTC(year, month, 1));
			const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
			return {
				start,
				end,
				label: `${year}-${String(month + 1).padStart(2, "0")}`,
				periodLabel: monthLabel(year, month),
			};
		}
		case "other_month": {
			const prevMonth = month === 0 ? 11 : month - 1;
			const prevYear = month === 0 ? year - 1 : year;
			const start = new Date(Date.UTC(prevYear, prevMonth, 1));
			const end = new Date(Date.UTC(prevYear, prevMonth + 1, 0, 23, 59, 59, 999));
			return {
				start,
				end,
				label: `${prevYear}-${String(prevMonth + 1).padStart(2, "0")}`,
				periodLabel: monthLabel(prevYear, prevMonth),
			};
		}
		case "quarter": {
			const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
			return {
				start,
				end: now,
				label: `${year}-${String(month + 1).padStart(2, "0")}`,
				periodLabel: "Últimos 3 meses",
			};
		}
		case "semester": {
			const start = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
			return {
				start,
				end: now,
				label: `${year}-${String(month + 1).padStart(2, "0")}`,
				periodLabel: "Últimos 6 meses",
			};
		}
		case "year": {
			const start = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
			return {
				start,
				end: now,
				label: `${year}`,
				periodLabel: "Últimos 12 meses",
			};
		}
		default: {
			const start = new Date(Date.UTC(year, month, 1));
			const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
			return {
				start,
				end,
				label: `${year}-${String(month + 1).padStart(2, "0")}`,
				periodLabel: monthLabel(year, month),
			};
		}
	}
}
