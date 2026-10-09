import { Prisma } from "../generated/prisma/client";
import {
	buildInstallmentDetail,
	formatInstallmentDescription,
	type InstallmentPlanForDetail,
	splitInstallment,
} from "./installment-billing.util";

const Decimal = Prisma.Decimal;

describe("splitInstallment", () => {
	it("returns the whole mensualidad as principal for MSI", () => {
		const split = splitInstallment({
			type: "MSI",
			monthlyAmount: new Decimal("333.33"),
			purchaseAmount: new Decimal(1000),
			totalMonths: 3,
		});

		expect(split.principal.toFixed(2)).toBe("333.33");
		expect(split.interest.toFixed(2)).toBe("0.00");
	});

	it("separates the MSCI interest component from the principal share", () => {
		const split = splitInstallment({
			type: "MSCI",
			monthlyAmount: new Decimal(560),
			purchaseAmount: new Decimal(6000),
			totalMonths: 12,
		});

		expect(split.principal.toFixed(2)).toBe("500.00");
		expect(split.interest.toFixed(2)).toBe("60.00");
	});

	it("rounds the MSCI interest to cents and keeps principal + interest = mensualidad", () => {
		// 1000 / 3 = 333.333… → interest = 350.00 - 333.333… = 16.666… → 16.67
		const split = splitInstallment({
			type: "MSCI",
			monthlyAmount: new Decimal(350),
			purchaseAmount: new Decimal(1000),
			totalMonths: 3,
		});

		expect(split.interest.toFixed(2)).toBe("16.67");
		expect(split.principal.toFixed(2)).toBe("333.33");
		expect(split.principal.add(split.interest).toFixed(2)).toBe("350.00");
	});

	it("never reports a negative MSCI interest", () => {
		const split = splitInstallment({
			type: "MSCI",
			monthlyAmount: new Decimal("333.33"),
			purchaseAmount: new Decimal(1000),
			totalMonths: 3,
		});

		expect(split.interest.toFixed(2)).toBe("0.00");
		expect(split.principal.toFixed(2)).toBe("333.33");
	});
});

describe("formatInstallmentDescription", () => {
	it("appends n/total to the purchase description", () => {
		expect(formatInstallmentDescription("Laptop", 2, 12)).toBe("Laptop (2/12)");
	});

	it("falls back to a generic label when the purchase has no description", () => {
		expect(formatInstallmentDescription(null, 1, 3)).toBe("Installment purchase (1/3)");
	});
});

describe("buildInstallmentDetail", () => {
	const purchase = {
		id: "tx-purchase",
		description: "Laptop",
		amount: new Decimal(3000),
		date: new Date(2026, 9, 5),
	};

	function plan(overrides: Partial<InstallmentPlanForDetail> = {}): InstallmentPlanForDetail {
		return {
			type: "MSI",
			status: "ACTIVE",
			totalMonths: 3,
			monthlyAmount: new Decimal(1000),
			transaction: purchase,
			installments: [{ statement: { isPaid: true } }, { statement: { isPaid: false } }],
			...overrides,
		};
	}

	it("summarizes billed, paid and remaining installments of an MSI plan", () => {
		const detail = buildInstallmentDetail(2, plan());

		expect(detail).toEqual({
			number: 2,
			totalInstallments: 3,
			billedInstallments: 2,
			paidInstallments: 1,
			remainingInstallments: 2,
			monthlyAmount: "1000.00",
			principalAmount: "1000.00",
			interestAmount: "0.00",
			remainingAmount: "2000.00",
			type: "MSI",
			status: "ACTIVE",
			purchase: {
				id: "tx-purchase",
				description: "Laptop",
				amount: "3000.00",
				date: purchase.date,
			},
		});
	});

	it("splits MSCI installments into principal and interest", () => {
		const detail = buildInstallmentDetail(
			1,
			plan({
				type: "MSCI",
				totalMonths: 12,
				monthlyAmount: new Decimal(560),
				transaction: { ...purchase, amount: new Decimal(6000) },
				installments: [{ statement: { isPaid: false } }],
			}),
		);

		expect(detail.principalAmount).toBe("500.00");
		expect(detail.interestAmount).toBe("60.00");
		expect(detail.paidInstallments).toBe(0);
		expect(detail.remainingInstallments).toBe(12);
		expect(detail.remainingAmount).toBe("6000.00");
	});

	it("counts every installment as paid when the plan was PAID_OFF", () => {
		const detail = buildInstallmentDetail(1, plan({ status: "PAID_OFF" }));

		expect(detail.paidInstallments).toBe(3);
		expect(detail.remainingInstallments).toBe(0);
		expect(detail.remainingAmount).toBe("0.00");
		expect(detail.billedInstallments).toBe(2);
	});

	it("ignores installment rows whose statement link was removed", () => {
		const detail = buildInstallmentDetail(
			1,
			plan({ installments: [{ statement: null }, { statement: { isPaid: true } }] }),
		);

		expect(detail.billedInstallments).toBe(2);
		expect(detail.paidInstallments).toBe(1);
	});
});
