import { Prisma } from "../generated/prisma/client";
import { computeStatementStatus } from "./statement-status.util";

const Decimal = Prisma.Decimal;

function makeStatement(over: Partial<Parameters<typeof computeStatementStatus>[0]> = {}) {
	return {
		isPaid: false,
		paymentDueDate: null,
		paidAmount: new Decimal(0),
		noInterestPayment: new Decimal(5000),
		balance: new Decimal(10000),
		...over,
	};
}

describe("computeStatementStatus", () => {
	const now = new Date("2026-11-02T12:00:00.000Z");

	it("returns 'paid' when isPaid is true", () => {
		expect(computeStatementStatus(makeStatement({ isPaid: true }), now)).toBe("paid");
	});

	it("returns 'pending' when due date is in the future", () => {
		expect(
			computeStatementStatus(
				makeStatement({ paymentDueDate: new Date("2026-11-28T00:00:00.000Z") }),
				now,
			),
		).toBe("pending");
	});

	it("returns 'pending' when due date is null", () => {
		expect(computeStatementStatus(makeStatement({ paymentDueDate: null }), now)).toBe("pending");
	});

	it("returns 'overdue' when due date passed and paidAmount < noInterestPayment", () => {
		expect(
			computeStatementStatus(
				makeStatement({
					paymentDueDate: new Date("2026-10-28T00:00:00.000Z"),
					paidAmount: new Decimal(0),
					noInterestPayment: new Decimal(5000),
				}),
				now,
			),
		).toBe("overdue");
	});

	it("returns 'overdue' when due date passed and paid partially but less than PNGI", () => {
		expect(
			computeStatementStatus(
				makeStatement({
					paymentDueDate: new Date("2026-10-28T00:00:00.000Z"),
					paidAmount: new Decimal(2000),
					noInterestPayment: new Decimal(5000),
				}),
				now,
			),
		).toBe("overdue");
	});

	it("returns 'partial' when due date passed and paidAmount >= noInterestPayment but < balance", () => {
		expect(
			computeStatementStatus(
				makeStatement({
					paymentDueDate: new Date("2026-10-28T00:00:00.000Z"),
					paidAmount: new Decimal(5000),
					noInterestPayment: new Decimal(5000),
					balance: new Decimal(10000),
				}),
				now,
			),
		).toBe("partial");
	});

	it("returns 'partial' when paid more than PNGI but less than full balance", () => {
		expect(
			computeStatementStatus(
				makeStatement({
					paymentDueDate: new Date("2026-10-28T00:00:00.000Z"),
					paidAmount: new Decimal(8000),
					noInterestPayment: new Decimal(5000),
					balance: new Decimal(10000),
				}),
				now,
			),
		).toBe("partial");
	});

	it("first statement with 0 interest and unpaid is 'overdue' when due date passed", () => {
		// This is the case that motivated the status field:
		// first statement has interestAmount: 0 but is still overdue
		expect(
			computeStatementStatus(
				makeStatement({
					paymentDueDate: new Date("2026-10-28T00:00:00.000Z"),
					paidAmount: new Decimal(0),
					noInterestPayment: new Decimal(200000),
					balance: new Decimal(200000),
				}),
				now,
			),
		).toBe("overdue");
	});

	it("treats due date exactly at 'now' as passed (overdue, not pending)", () => {
		expect(
			computeStatementStatus(
				makeStatement({
					paymentDueDate: now,
					paidAmount: new Decimal(0),
					noInterestPayment: new Decimal(5000),
				}),
				now,
			),
		).toBe("overdue");
	});
});
