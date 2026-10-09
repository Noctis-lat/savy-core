import type { InstallmentPlanType } from "../generated/prisma/client";
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
