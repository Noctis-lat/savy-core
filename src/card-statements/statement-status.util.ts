import type { CardStatement } from "../generated/prisma/client";

export type StatementStatus = "pending" | "overdue" | "partial" | "paid";

/**
 * Computes the display status of a card statement from its raw fields.
 *
 * - "paid"    — isPaid is true (fully settled)
 * - "pending" — isPaid false, due date hasn't arrived yet (or no due date)
 * - "partial" — due date passed, paid ≥ noInterestPayment but < balance (avoided interest, still owes)
 * - "overdue" — due date passed, paid < noInterestPayment (interest will be charged next period)
 *
 * The first statement of a card typically has interestAmount: 0 because there
 * is no previous period. It can still be "overdue" if the due date passed
 * without paying the PNGI — the consequence appears on the NEXT statement.
 */
export function computeStatementStatus(
	statement: Pick<
		CardStatement,
		"isPaid" | "paymentDueDate" | "paidAmount" | "noInterestPayment" | "balance"
	>,
	now: Date = new Date(),
): StatementStatus {
	if (statement.isPaid) return "paid";

	const dueDate = statement.paymentDueDate;
	if (!dueDate || dueDate > now) return "pending";

	// Due date has passed — did the user pay enough to avoid interest?
	const paidAmount = Number(statement.paidAmount);
	const noInterestPayment = Number(statement.noInterestPayment);

	if (paidAmount >= noInterestPayment) return "partial";
	return "overdue";
}
