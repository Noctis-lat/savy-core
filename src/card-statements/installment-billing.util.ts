import type { InstallmentPlanStatus, InstallmentPlanType } from "../generated/prisma/client";
import { Prisma } from "../generated/prisma/client";

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

/** Label used for installment rows whose purchase has no description. */
const FALLBACK_PURCHASE_DESCRIPTION = "Installment purchase";

export interface InstallmentSplitInput {
	type: InstallmentPlanType;
	monthlyAmount: Decimal;
	purchaseAmount: Decimal;
	totalMonths: number;
}

export interface InstallmentSplit {
	principal: Decimal;
	interest: Decimal;
}

/**
 * Splits one installment (mensualidad) into principal and interest.
 *
 * MSI: the whole mensualidad is principal.
 * MSCI: interest = mensualidad − purchase / totalMonths, rounded to cents and
 * never negative; principal is the remainder so principal + interest always
 * equals the mensualidad exactly.
 */
export function splitInstallment(input: InstallmentSplitInput): InstallmentSplit {
	const monthly = new Decimal(input.monthlyAmount);
	if (input.type !== "MSCI") {
		return { principal: monthly, interest: new Decimal(0) };
	}
	const principalShare = new Decimal(input.purchaseAmount).div(input.totalMonths);
	const interest = Decimal.max(monthly.sub(principalShare), 0).toDecimalPlaces(2);
	return { principal: monthly.sub(interest), interest };
}

/** Builds the statement label of an installment row, e.g. "Laptop (2/12)". */
export function formatInstallmentDescription(
	purchaseDescription: string | null,
	installmentNumber: number,
	totalInstallments: number,
): string {
	const label = purchaseDescription ?? FALLBACK_PURCHASE_DESCRIPTION;
	return `${label} (${installmentNumber}/${totalInstallments})`;
}

/** Installment plan shape needed to describe one installment in a statement. */
export interface InstallmentPlanForDetail {
	type: InstallmentPlanType;
	status: InstallmentPlanStatus;
	totalMonths: number;
	monthlyAmount: Decimal;
	transaction: {
		id: string;
		description: string | null;
		amount: Decimal;
		date: Date;
	};
	/** Every installment row generated so far, with the paid flag of its statement. */
	installments: Array<{ statement: { isPaid: boolean } | null }>;
}

export interface InstallmentDetail {
	number: number;
	totalInstallments: number;
	billedInstallments: number;
	paidInstallments: number;
	remainingInstallments: number;
	monthlyAmount: string;
	principalAmount: string;
	interestAmount: string;
	remainingAmount: string;
	type: InstallmentPlanType;
	status: InstallmentPlanStatus;
	purchase: {
		id: string;
		description: string | null;
		amount: string;
		date: Date;
	};
}

/**
 * Describes one installment row for the statement detail. Money values are
 * strings with 2 decimals (same convention as availableCredit).
 *
 * paidInstallments counts installment rows whose statement is paid; a PAID_OFF
 * plan counts all of its installments as paid. remainingAmount is the unpaid
 * principal: purchase × remainingInstallments / totalInstallments.
 */
export function buildInstallmentDetail(
	installmentNumber: number,
	plan: InstallmentPlanForDetail,
): InstallmentDetail {
	const total = plan.totalMonths;
	const purchaseAmount = new Decimal(plan.transaction.amount);
	const paid =
		plan.status === "PAID_OFF"
			? total
			: plan.installments.filter((i) => i.statement?.isPaid === true).length;
	const remaining = Math.max(total - paid, 0);
	const { principal, interest } = splitInstallment({
		type: plan.type,
		monthlyAmount: plan.monthlyAmount,
		purchaseAmount,
		totalMonths: total,
	});

	return {
		number: installmentNumber,
		totalInstallments: total,
		billedInstallments: plan.installments.length,
		paidInstallments: paid,
		remainingInstallments: remaining,
		monthlyAmount: new Decimal(plan.monthlyAmount).toFixed(2),
		principalAmount: principal.toFixed(2),
		interestAmount: interest.toFixed(2),
		remainingAmount: purchaseAmount.mul(remaining).div(total).toFixed(2),
		type: plan.type,
		status: plan.status,
		purchase: {
			id: plan.transaction.id,
			description: plan.transaction.description,
			amount: purchaseAmount.toFixed(2),
			date: plan.transaction.date,
		},
	};
}
