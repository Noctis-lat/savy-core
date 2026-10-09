import { Prisma } from "../generated/prisma/client";
import { formatInstallmentDescription, splitInstallment } from "./installment-billing.util";

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
