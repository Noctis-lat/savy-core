import { Prisma } from "../../generated/prisma/client";
import { CreditCalculationService } from "./credit-calculation.service";

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

describe("CreditCalculationService", () => {
	let service: CreditCalculationService;

	beforeEach(() => {
		service = new CreditCalculationService();
	});

	describe("calculateAverageDailyBalance", () => {
		it("single purchase mid-period: (0×14 + 3000×16)/30 = 1600.00 (balance applies on day of purchase)", () => {
			const periodStart = new Date(2026, 0, 1); // Jan 1
			const periodEnd = new Date(2026, 0, 30); // Jan 30 (30-day period)
			const startingBalance = new Decimal(0);
			const transactions = [
				{ date: new Date(2026, 0, 15), type: "EXPENSE", amount: new Decimal(3000) },
			];
			const result = service.calculateAverageDailyBalance(
				periodStart,
				periodEnd,
				transactions,
				startingBalance,
			);
			// Days 1-14: 0 (14 days), days 15-30: 3000 (16 days) = 48000/30 = 1600.00
			expect(result.toFixed(2)).toBe("1600.00");
		});

		it("multiple purchases: (0×4 + 1000×15 + 3000×11)/30 = 1600.00", () => {
			const periodStart = new Date(2026, 0, 1);
			const periodEnd = new Date(2026, 0, 30);
			const startingBalance = new Decimal(0);
			const transactions = [
				{ date: new Date(2026, 0, 5), type: "EXPENSE", amount: new Decimal(1000) },
				{ date: new Date(2026, 0, 20), type: "EXPENSE", amount: new Decimal(2000) },
			];
			const result = service.calculateAverageDailyBalance(
				periodStart,
				periodEnd,
				transactions,
				startingBalance,
			);
			expect(result.toFixed(2)).toBe("1600.00");
		});

		it("payment reduces balance: (5000×9 + 3000×21)/30 = 3600.00", () => {
			const periodStart = new Date(2026, 0, 1);
			const periodEnd = new Date(2026, 0, 30);
			const startingBalance = new Decimal(5000);
			const transactions = [
				{ date: new Date(2026, 0, 10), type: "PAYMENT", amount: new Decimal(2000) },
			];
			const result = service.calculateAverageDailyBalance(
				periodStart,
				periodEnd,
				transactions,
				startingBalance,
			);
			expect(result.toFixed(2)).toBe("3600.00");
		});

		it("saldo a favor treated as 0 for interest: (0×14 + 1000×16)/30 = 533.33", () => {
			const periodStart = new Date(2026, 0, 1);
			const periodEnd = new Date(2026, 0, 30);
			const startingBalance = new Decimal(-1000);
			const transactions = [
				{ date: new Date(2026, 0, 15), type: "EXPENSE", amount: new Decimal(2000) },
			];
			const result = service.calculateAverageDailyBalance(
				periodStart,
				periodEnd,
				transactions,
				startingBalance,
			);
			// Days 1-14: -1000 clamped to 0 (14 days), days 15-30: 1000 (16 days)
			expect(result.toFixed(2)).toBe("533.33");
		});

		it("full period saldo a favor → 0.00", () => {
			const periodStart = new Date(2026, 0, 1);
			const periodEnd = new Date(2026, 0, 30);
			const startingBalance = new Decimal(-500);
			const transactions: Array<{ date: Date; type: string; amount: Decimal }> = [];
			const result = service.calculateAverageDailyBalance(
				periodStart,
				periodEnd,
				transactions,
				startingBalance,
			);
			expect(result.toFixed(2)).toBe("0.00");
		});
	});

	describe("calculateInterest", () => {
		it("standard: avgDailyBalance 1500, rate 0.36, 30 days → preIva 45.00, iva 7.20, total 52.20", () => {
			const result = service.calculateInterest({
				averageDailyBalance: new Decimal(1500),
				annualRate: new Decimal(0.36),
				periodDays: 30,
			});
			expect(result.preIva.toFixed(2)).toBe("45.00");
			expect(result.iva.toFixed(2)).toBe("7.20");
			expect(result.total.toFixed(2)).toBe("52.20");
		});

		it("zero balance → all zeros", () => {
			const result = service.calculateInterest({
				averageDailyBalance: new Decimal(0),
				annualRate: new Decimal(0.36),
				periodDays: 30,
			});
			expect(result.preIva.toFixed(2)).toBe("0.00");
			expect(result.iva.toFixed(2)).toBe("0.00");
			expect(result.total.toFixed(2)).toBe("0.00");
		});

		it("triangulation: avgDailyBalance 1000, rate 0.48, 30 days → preIva 40.00, iva 6.40, total 46.40", () => {
			const result = service.calculateInterest({
				averageDailyBalance: new Decimal(1000),
				annualRate: new Decimal(0.48),
				periodDays: 30,
			});
			expect(result.preIva.toFixed(2)).toBe("40.00");
			expect(result.iva.toFixed(2)).toBe("6.40");
			expect(result.total.toFixed(2)).toBe("46.40");
		});
	});

	describe("calculatePngi", () => {
		it("no plans → pngi = saldoDeudor (5000.00)", () => {
			const result = service.calculatePngi({
				totalSaldoDeudor: new Decimal(5000),
				installmentPlans: [],
			});
			expect(result.toFixed(2)).toBe("5000.00");
		});

		it("MSI exclusion: 8000 - 6000 + 500 = 2500.00", () => {
			const result = service.calculatePngi({
				totalSaldoDeudor: new Decimal(8000),
				installmentPlans: [
					{
						type: "MSI",
						remainingBalance: new Decimal(6000),
						currentMensualidad: new Decimal(500),
						status: "ACTIVE",
					},
				],
			});
			expect(result.toFixed(2)).toBe("2500.00");
		});

		it("multiple plans: 10000 - 3000 - 4000 + 500 + 700 = 4200.00", () => {
			const result = service.calculatePngi({
				totalSaldoDeudor: new Decimal(10000),
				installmentPlans: [
					{
						type: "MSI",
						remainingBalance: new Decimal(3000),
						currentMensualidad: new Decimal(500),
						status: "ACTIVE",
					},
					{
						type: "MSCI",
						remainingBalance: new Decimal(4000),
						currentMensualidad: new Decimal(700),
						status: "ACTIVE",
					},
				],
			});
			expect(result.toFixed(2)).toBe("4200.00");
		});

		it("COMPLETED and CANCELLED plans excluded", () => {
			const result = service.calculatePngi({
				totalSaldoDeudor: new Decimal(10000),
				installmentPlans: [
					{
						type: "MSI",
						remainingBalance: new Decimal(3000),
						currentMensualidad: new Decimal(500),
						status: "ACTIVE",
					},
					{
						type: "MSCI",
						remainingBalance: new Decimal(2000),
						currentMensualidad: new Decimal(300),
						status: "COMPLETED",
					},
					{
						type: "MSI",
						remainingBalance: new Decimal(1000),
						currentMensualidad: new Decimal(200),
						status: "CANCELLED",
					},
				],
			});
			// Only ACTIVE plan counts: 10000 - 3000 + 500 = 7500.00
			expect(result.toFixed(2)).toBe("7500.00");
		});
	});

	describe("calculateMinimumPayment", () => {
		it("formula (a) wins: 1.5%×5000 + 52.20 = 127.20 > 1.25%×10000 = 125.00", () => {
			const result = service.calculateMinimumPayment({
				revolvingBalance: new Decimal(5000),
				periodInterest: new Decimal(52.2),
				creditLimit: new Decimal(10000),
				statementBalance: new Decimal(5000),
			});
			expect(result.toFixed(2)).toBe("127.20");
		});

		it("formula (b) wins: 1.5%×1000 + 0 = 15.00 < 1.25%×20000 = 250.00", () => {
			const result = service.calculateMinimumPayment({
				revolvingBalance: new Decimal(1000),
				periodInterest: new Decimal(0),
				creditLimit: new Decimal(20000),
				statementBalance: new Decimal(1000),
			});
			expect(result.toFixed(2)).toBe("250.00");
		});

		it("balance cap: formula (b) 625.00 capped to 500.00", () => {
			const result = service.calculateMinimumPayment({
				revolvingBalance: new Decimal(500),
				periodInterest: new Decimal(0),
				creditLimit: new Decimal(50000),
				statementBalance: new Decimal(500),
			});
			expect(result.toFixed(2)).toBe("500.00");
		});

		it("zero balance → 0.00", () => {
			const result = service.calculateMinimumPayment({
				revolvingBalance: new Decimal(0),
				periodInterest: new Decimal(0),
				creditLimit: new Decimal(10000),
				statementBalance: new Decimal(0),
			});
			expect(result.toFixed(2)).toBe("0.00");
		});

		it("zero balance with high credit limit → 0.00", () => {
			const result = service.calculateMinimumPayment({
				revolvingBalance: new Decimal(0),
				periodInterest: new Decimal(0),
				creditLimit: new Decimal(50000),
				statementBalance: new Decimal(0),
			});
			expect(result.toFixed(2)).toBe("0.00");
		});

		it("no intermediate rounding: 3333.33 × 1.5% + 0 = 49.99995 → 50.00 (formula A wins with low credit limit)", () => {
			const result = service.calculateMinimumPayment({
				revolvingBalance: new Decimal(3333.33),
				periodInterest: new Decimal(0),
				creditLimit: new Decimal(1000), // formula B = 12.50 < 49.99995
				statementBalance: new Decimal(3333.33),
			});
			// 3333.33 × 0.015 = 49.99995 → rounded to 50.00
			expect(result.toFixed(2)).toBe("50.00");
		});
	});

	describe("calculatePaymentDueDate", () => {
		it("standard 20-day offset: Oct 15 + 20 = Nov 4", () => {
			const result = service.calculatePaymentDueDate(new Date(2026, 9, 15), 20);
			expect(result.toDateString()).toBe(new Date(2026, 10, 4).toDateString());
		});

		it("custom 15-day offset: Nov 1 + 15 = Nov 16 (Revolución holiday) → Nov 17", () => {
			const result = service.calculatePaymentDueDate(new Date(2026, 10, 1), 15);
			// Nov 16 2026 is third Monday of November = Revolución holiday → Nov 17
			expect(result.toDateString()).toBe(new Date(2026, 10, 17).toDateString());
		});

		it("Saturday Nov 7 2026 → Monday Nov 9 2026", () => {
			// Cut date Oct 18 + 20 = Nov 7 (Saturday) → Nov 9 (Monday)
			const result = service.calculatePaymentDueDate(new Date(2026, 9, 18), 20);
			expect(result.toDateString()).toBe(new Date(2026, 10, 9).toDateString());
		});

		it("Sunday Nov 8 2026 → Monday Nov 9 2026", () => {
			// Cut date Oct 19 + 20 = Nov 8 (Sunday) → Nov 9 (Monday)
			const result = service.calculatePaymentDueDate(new Date(2026, 9, 19), 20);
			expect(result.toDateString()).toBe(new Date(2026, 10, 9).toDateString());
		});

		it("holiday: Sep 21 2026 (Independencia observed, Monday) → Sep 22 2026", () => {
			// Cut date Sep 1 + 20 = Sep 21 (holiday, Monday) → Sep 22
			const result = service.calculatePaymentDueDate(new Date(2026, 8, 1), 20);
			expect(result.toDateString()).toBe(new Date(2026, 8, 22).toDateString());
		});

		it("already business day → no change", () => {
			// Nov 4 2026 is a Wednesday (business day)
			const result = service.calculatePaymentDueDate(new Date(2026, 9, 15), 20);
			expect(result.toDateString()).toBe(new Date(2026, 10, 4).toDateString());
		});

		it("triangulation: Jan 1 2027 (holiday) + 0 offset → Jan 4 2027 (Monday)", () => {
			// Jan 1 2027 is a holiday (Friday) → skip to Jan 4 (Monday)
			const result = service.calculatePaymentDueDate(new Date(2027, 0, 1), 0);
			expect(result.toDateString()).toBe(new Date(2027, 0, 4).toDateString());
		});
	});

	describe("applyPaymentWaterfall", () => {
		it("partial interest: 600 payment, 500 interest, 200 commissions → 500 interest, 100 commissions, remainder 0", () => {
			const result = service.applyPaymentWaterfall({
				paymentAmount: new Decimal(600),
				interestAmount: new Decimal(500),
				commissionTotal: new Decimal(200),
				ordinaryBalance: new Decimal(2000),
				msiMensualidadTotal: new Decimal(0),
				msciMensualidadTotal: new Decimal(0),
			});
			expect(result.interestApplied.toFixed(2)).toBe("500.00");
			expect(result.commissionsApplied.toFixed(2)).toBe("100.00");
			expect(result.ordinaryApplied.toFixed(2)).toBe("0.00");
			expect(result.msiApplied.toFixed(2)).toBe("0.00");
			expect(result.msciApplied.toFixed(2)).toBe("0.00");
			expect(result.remainder.toFixed(2)).toBe("0.00");
		});

		it("full coverage with remainder: 2500 payment covers 300 interest + 100 commissions + 2000 ordinary → remainder 100", () => {
			const result = service.applyPaymentWaterfall({
				paymentAmount: new Decimal(2500),
				interestAmount: new Decimal(300),
				commissionTotal: new Decimal(100),
				ordinaryBalance: new Decimal(2000),
				msiMensualidadTotal: new Decimal(500),
				msciMensualidadTotal: new Decimal(300),
			});
			expect(result.interestApplied.toFixed(2)).toBe("300.00");
			expect(result.commissionsApplied.toFixed(2)).toBe("100.00");
			expect(result.ordinaryApplied.toFixed(2)).toBe("2000.00");
			expect(result.msiApplied.toFixed(2)).toBe("100.00");
			expect(result.msciApplied.toFixed(2)).toBe("0.00");
			expect(result.remainder.toFixed(2)).toBe("0.00");
		});

		it("empty categories: 0 interest, 0 commissions → all to ordinary", () => {
			const result = service.applyPaymentWaterfall({
				paymentAmount: new Decimal(1000),
				interestAmount: new Decimal(0),
				commissionTotal: new Decimal(0),
				ordinaryBalance: new Decimal(3000),
				msiMensualidadTotal: new Decimal(0),
				msciMensualidadTotal: new Decimal(0),
			});
			expect(result.interestApplied.toFixed(2)).toBe("0.00");
			expect(result.commissionsApplied.toFixed(2)).toBe("0.00");
			expect(result.ordinaryApplied.toFixed(2)).toBe("1000.00");
			expect(result.msiApplied.toFixed(2)).toBe("0.00");
			expect(result.msciApplied.toFixed(2)).toBe("0.00");
			expect(result.remainder.toFixed(2)).toBe("0.00");
		});

		it("payment exceeds all categories → remainder > 0", () => {
			const result = service.applyPaymentWaterfall({
				paymentAmount: new Decimal(5000),
				interestAmount: new Decimal(100),
				commissionTotal: new Decimal(200),
				ordinaryBalance: new Decimal(1000),
				msiMensualidadTotal: new Decimal(300),
				msciMensualidadTotal: new Decimal(400),
			});
			expect(result.interestApplied.toFixed(2)).toBe("100.00");
			expect(result.commissionsApplied.toFixed(2)).toBe("200.00");
			expect(result.ordinaryApplied.toFixed(2)).toBe("1000.00");
			expect(result.msiApplied.toFixed(2)).toBe("300.00");
			expect(result.msciApplied.toFixed(2)).toBe("400.00");
			expect(result.remainder.toFixed(2)).toBe("3000.00");
		});

		it("triangulation: small payment only covers part of interest", () => {
			const result = service.applyPaymentWaterfall({
				paymentAmount: new Decimal(200),
				interestAmount: new Decimal(500),
				commissionTotal: new Decimal(200),
				ordinaryBalance: new Decimal(2000),
				msiMensualidadTotal: new Decimal(0),
				msciMensualidadTotal: new Decimal(0),
			});
			expect(result.interestApplied.toFixed(2)).toBe("200.00");
			expect(result.commissionsApplied.toFixed(2)).toBe("0.00");
			expect(result.ordinaryApplied.toFixed(2)).toBe("0.00");
			expect(result.remainder.toFixed(2)).toBe("0.00");
		});
	});

	describe("calculateMsciMonthlyAmount", () => {
		it("principal 6000, rate 0.12, 12 months → monthlyInterest 60.00, monthlyAmount 560.00", () => {
			const result = service.calculateMsciMonthlyAmount(new Decimal(6000), new Decimal(0.12), 12);
			expect(result.toFixed(2)).toBe("560.00");
		});

		it("triangulation: principal 10000, rate 0.24, 24 months → monthlyInterest 100.00, monthlyAmount 516.67", () => {
			const result = service.calculateMsciMonthlyAmount(new Decimal(10000), new Decimal(0.24), 24);
			expect(result.toFixed(2)).toBe("516.67");
		});
	});
});
