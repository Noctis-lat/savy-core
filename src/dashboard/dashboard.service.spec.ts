import { Test, type TestingModule } from "@nestjs/testing";
import { BudgetsService } from "../budgets/budgets.service";
import { StatementGenerationService } from "../card-statements/statement-generation.service";
import type { Profile } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { DashboardService } from "./dashboard.service";

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function mockAccount(over: DeepPartial<Record<string, unknown>> = {}) {
	return {
		id: "acct-1",
		profileId: "profile-1",
		bankId: null,
		name: "Account",
		type: "DEBIT",
		currency: "MXN",
		balance: { toString: () => "1000" } as unknown as object,
		color: null,
		icon: null,
		isActive: true,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		...over,
	} as Record<string, unknown>;
}

function asDecimal(value: number) {
	return { toString: () => String(value) } as unknown as object;
}

describe("DashboardService", () => {
	let service: DashboardService;
	let prisma: { [k: string]: { findMany: jest.Mock } };
	let budgetsService: { getProgressForAll: jest.Mock };
	let statementGenerationService: { generatePending: jest.Mock };

	const profile = { id: "profile-1", currency: "MXN" } as Profile;

	function setupFindMany(map: Record<string, unknown[]>) {
		for (const [key, value] of Object.entries(map)) {
			prisma[key].findMany.mockResolvedValue(value);
		}
	}

	beforeEach(async () => {
		prisma = {
			account: { findMany: jest.fn() },
			transaction: { findMany: jest.fn() },
			savingsGoal: { findMany: jest.fn() },
			creditCard: { findMany: jest.fn() },
			loan: { findMany: jest.fn() },
			bank: { findMany: jest.fn() },
			incomeSource: { findMany: jest.fn().mockResolvedValue([]) },
			recurringExpense: { findMany: jest.fn().mockResolvedValue([]) },
		};
		budgetsService = { getProgressForAll: jest.fn() };
		statementGenerationService = { generatePending: jest.fn().mockResolvedValue(undefined) };

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				DashboardService,
				{ provide: PrismaService, useValue: prisma },
				{ provide: BudgetsService, useValue: budgetsService },
				{ provide: StatementGenerationService, useValue: statementGenerationService },
			],
		}).compile();

		service = module.get(DashboardService);
	});

	it("aggregates a populated profile into the full summary shape", async () => {
		setupFindMany({
			account: [
				mockAccount({ id: "a-debit", type: "DEBIT", balance: asDecimal(10000) }),
				mockAccount({ id: "a-cash", type: "CASH", balance: asDecimal(2000) }),
				mockAccount({ id: "a-credit", type: "CREDIT", balance: asDecimal(3000) }),
				mockAccount({ id: "a-loan", type: "LOAN", balance: asDecimal(5000) }),
			],
			transaction: [],
			savingsGoal: [],
			creditCard: [],
			loan: [],
			bank: [],
		});
		budgetsService.getProgressForAll.mockResolvedValue([
			{
				id: "b-1",
				categoryName: "Groceries",
				spent: 3200,
				budget: 5000,
				remaining: 1800,
				percentage: 64,
			},
		]);

		const summary = await service.getSummary(profile);

		// netWorth
		expect(summary.netWorth.assets).toBe(12000);
		expect(summary.netWorth.liabilities).toBe(8000);
		expect(summary.netWorth.total).toBe(4000);
		expect(summary.netWorth.currency).toBe("MXN");
		expect(summary.netWorth.monthDelta).toBeNull();

		// accountsDistribution (4 types, sorted by totalBalance desc)
		expect(summary.accountsDistribution).toHaveLength(4);
		const debit = summary.accountsDistribution.find((d) => d.type === "DEBIT");
		expect(debit?.count).toBe(1);
		expect(debit?.totalBalance).toBe(10000);
		expect(debit?.percentage).toBe(50); // 10000 / (10000+2000+3000+5000) * 100 = 50

		// activeBudgets sorted by percentage desc, top 4
		expect(summary.activeBudgets).toHaveLength(1);
		expect(summary.activeBudgets[0].categoryName).toBe("Groceries");
		expect(summary.activeBudgets[0].remaining).toBe(1800);

		// arrays present (empty)
		expect(summary.recentTransactions).toEqual([]);
		expect(summary.savingsGoals).toEqual([]);
		expect(summary.creditOverview.creditCards).toEqual([]);
		expect(summary.creditOverview.loans).toEqual([]);
		expect(summary.banks).toEqual([]);

		// generatedAt is an ISO string
		expect(typeof summary.generatedAt).toBe("string");
		expect(new Date(summary.generatedAt).toString()).not.toBe("Invalid Date");
	});

	it("returns a zeroed summary for an empty profile without division errors", async () => {
		setupFindMany({
			account: [],
			transaction: [],
			savingsGoal: [],
			creditCard: [],
			loan: [],
			bank: [],
		});
		budgetsService.getProgressForAll.mockResolvedValue([]);

		const summary = await service.getSummary(profile);

		expect(summary.netWorth.total).toBe(0);
		expect(summary.netWorth.assets).toBe(0);
		expect(summary.netWorth.liabilities).toBe(0);
		expect(summary.accountsDistribution).toEqual([]);
		expect(summary.recentTransactions).toEqual([]);
		expect(summary.activeBudgets).toEqual([]);
		expect(summary.savingsGoals).toEqual([]);
		expect(summary.creditOverview.creditCards).toEqual([]);
		expect(summary.creditOverview.loans).toEqual([]);
		expect(summary.banks).toEqual([]);
	});

	it("treats only CREDIT/LOAN as liabilities and DEBIT/CASH as assets (only debts case)", async () => {
		setupFindMany({
			account: [
				mockAccount({ id: "c1", type: "CREDIT", balance: asDecimal(8000) }),
				mockAccount({ id: "l1", type: "LOAN", balance: asDecimal(200000) }),
			],
			transaction: [],
			savingsGoal: [],
			creditCard: [],
			loan: [],
			bank: [],
		});
		budgetsService.getProgressForAll.mockResolvedValue([]);

		const summary = await service.getSummary(profile);

		expect(summary.netWorth.assets).toBe(0);
		expect(summary.netWorth.liabilities).toBe(208000);
		expect(summary.netWorth.total).toBe(-208000);
	});

	it("excludes system INSTALLMENT rows from recentTransactions so they never read as spending", async () => {
		setupFindMany({
			account: [mockAccount({ id: "a-credit", type: "CREDIT", balance: asDecimal(3000) })],
			transaction: [],
			savingsGoal: [],
			creditCard: [],
			loan: [],
			bank: [],
		});
		budgetsService.getProgressForAll.mockResolvedValue([]);

		await service.getSummary(profile);

		const call = prisma.transaction.findMany.mock.calls[0][0];
		expect(call.where).toEqual({
			accountId: { in: ["a-credit"] },
			type: { not: "INSTALLMENT" },
		});
	});

	it("returns the full transaction objects for recentTransactions", async () => {
		const row = {
			id: "tx-1",
			type: "EXPENSE",
			amount: asDecimal(1500),
			description: "Groceries",
			date: new Date("2026-07-29T12:00:00.000Z"),
		};
		setupFindMany({
			account: [mockAccount({ id: "a-debit", type: "DEBIT", balance: asDecimal(100) })],
			transaction: [row],
			savingsGoal: [],
			creditCard: [],
			loan: [],
			bank: [],
		});
		budgetsService.getProgressForAll.mockResolvedValue([]);

		const summary = await service.getSummary(profile);

		// Contract (b6e6a21): the service passes Prisma transaction rows through untouched.
		expect(summary.recentTransactions).toHaveLength(1);
		expect(summary.recentTransactions[0]).toBe(row);
	});

	it("computes credit card overview using latest statement when present", async () => {
		setupFindMany({
			account: [mockAccount({ id: "cc-acct", type: "CREDIT", balance: asDecimal(4000) })],
			transaction: [],
			savingsGoal: [],
			creditCard: [
				{
					id: "card-1",
					creditLimit: asDecimal(50000),
					account: mockAccount({ id: "cc-acct", balance: asDecimal(4000) }),
					statements: [
						{
							balance: asDecimal(12000),
							minPayment: asDecimal(600),
							noInterestPayment: asDecimal(12000),
							interestAmount: asDecimal(0),
							periodEnd: new Date("2026-08-25T00:00:00.000Z"),
							paymentDueDate: new Date("2026-09-14T00:00:00.000Z"),
							isPaid: false,
						},
					],
				},
			],
			loan: [],
			bank: [],
		});
		budgetsService.getProgressForAll.mockResolvedValue([]);

		const summary = await service.getSummary(profile);

		const card = summary.creditOverview.creditCards[0];
		expect(card.id).toBe("card-1");
		expect(card.creditLimit).toBe(50000);
		expect(card.available).toBe(38000); // 50000 - 12000
		expect(card.minPayment).toBe(600);
		expect(card.nextPaymentDue).toBe("2026-09-14T00:00:00.000Z");
	});

	it("computes loan summary and null nextPaymentDue", async () => {
		setupFindMany({
			account: [],
			transaction: [],
			savingsGoal: [],
			creditCard: [],
			loan: [
				{
					id: "loan-1",
					principal: asDecimal(200000),
					remaining: asDecimal(185000),
					monthlyPayment: asDecimal(6800),
				},
			],
			bank: [],
		});
		budgetsService.getProgressForAll.mockResolvedValue([]);

		const summary = await service.getSummary(profile);

		expect(summary.creditOverview.loans).toHaveLength(1);
		const loan = summary.creditOverview.loans[0];
		expect(loan.id).toBe("loan-1");
		expect(loan.principal).toBe(200000);
		expect(loan.remaining).toBe(185000);
		expect(loan.monthlyPayment).toBe(6800);
		expect(loan.nextPaymentDue).toBeNull();
	});

	it("maps banks with accountCount from _count", async () => {
		setupFindMany({
			account: [],
			transaction: [],
			savingsGoal: [],
			creditCard: [],
			loan: [],
			bank: [
				{ id: "b-1", name: "BBVA", color: "#000", logo: "bbva", _count: { accounts: 5 } },
				{ id: "b-2", name: "Citi", color: null, logo: null, _count: { accounts: 2 } },
			],
		});
		budgetsService.getProgressForAll.mockResolvedValue([]);

		const summary = await service.getSummary(profile);

		expect(summary.banks).toHaveLength(2);
		expect(summary.banks[0].accountCount).toBe(5); // sorted desc
		expect(summary.banks[1].accountCount).toBe(2);
		expect(summary.banks[1].color).toBeNull();
	});

	it("sorts savings goals with incomplete first, then by deadline asc, top 4", async () => {
		setupFindMany({
			account: [],
			transaction: [],
			savingsGoal: [
				{
					id: "g-done",
					name: "Done",
					targetAmount: asDecimal(1000),
					deadline: null,
					account: { balance: asDecimal(1000) },
				},
				{
					id: "g-a",
					name: "A",
					targetAmount: asDecimal(10000),
					deadline: new Date("2026-12-31T00:00:00.000Z"),
					account: { balance: asDecimal(2000) },
				},
				{
					id: "g-b",
					name: "B",
					targetAmount: asDecimal(10000),
					deadline: new Date("2026-09-30T00:00:00.000Z"),
					account: { balance: asDecimal(500) },
				},
			],
			creditCard: [],
			loan: [],
			bank: [],
		});
		budgetsService.getProgressForAll.mockResolvedValue([]);

		const summary = await service.getSummary(profile);

		expect(summary.savingsGoals).toHaveLength(3);
		// Incomplete first, sorted by deadline asc
		expect(summary.savingsGoals[0].id).toBe("g-b");
		expect(summary.savingsGoals[1].id).toBe("g-a");
		expect(summary.savingsGoals[2].id).toBe("g-done");
		expect(summary.savingsGoals[2].isCompleted).toBe(true);
		expect(summary.savingsGoals[0].isCompleted).toBe(false);
		expect(summary.savingsGoals[0].deadline).toBe("2026-09-30T00:00:00.000Z");
	});

	// ─── T-046: generatePending trigger before Promise.all ──────────────

	it("calls statementGenerationService.generatePending(profile.id) before Promise.all", async () => {
		setupFindMany({
			account: [mockAccount({ id: "a-debit", type: "DEBIT", balance: asDecimal(100) })],
			transaction: [],
			savingsGoal: [],
			creditCard: [],
			loan: [],
			bank: [],
		});
		budgetsService.getProgressForAll.mockResolvedValue([]);

		await service.getSummary(profile);

		expect(statementGenerationService.generatePending).toHaveBeenCalledTimes(1);
		expect(statementGenerationService.generatePending).toHaveBeenCalledWith("profile-1");
	});

	// ─── T-048: computeCreditOverview uses paymentDueDate, exposes noInterestPayment + interestAmount ──

	it("computeCreditOverview uses paymentDueDate (not periodEnd) and exposes noInterestPayment + interestAmount", async () => {
		const paymentDueDate = new Date("2026-11-04T00:00:00.000Z");
		setupFindMany({
			account: [mockAccount({ id: "cc-acct", type: "CREDIT", balance: asDecimal(4000) })],
			transaction: [],
			savingsGoal: [],
			creditCard: [
				{
					id: "card-1",
					creditLimit: asDecimal(50000),
					account: mockAccount({ id: "cc-acct", balance: asDecimal(4000) }),
					statements: [
						{
							balance: asDecimal(12000),
							minPayment: asDecimal(600),
							noInterestPayment: asDecimal(12000),
							interestAmount: asDecimal(52.2),
							periodEnd: new Date("2026-08-25T00:00:00.000Z"),
							paymentDueDate,
							isPaid: false,
						},
					],
				},
			],
			loan: [],
			bank: [],
		});
		budgetsService.getProgressForAll.mockResolvedValue([]);

		const summary = await service.getSummary(profile);

		const card = summary.creditOverview.creditCards[0];
		expect(card.id).toBe("card-1");
		expect(card.nextPaymentDue).toBe(paymentDueDate.toISOString());
		expect(card.noInterestPayment).toBe(12000);
		expect(card.interestAmount).toBe(52.2);
		expect(card.minPayment).toBe(600);
	});

	it("computeCreditOverview returns null nextPaymentDue when statement is paid", async () => {
		setupFindMany({
			account: [mockAccount({ id: "cc-acct", type: "CREDIT", balance: asDecimal(4000) })],
			transaction: [],
			savingsGoal: [],
			creditCard: [
				{
					id: "card-1",
					creditLimit: asDecimal(50000),
					account: mockAccount({ id: "cc-acct", balance: asDecimal(4000) }),
					statements: [
						{
							balance: asDecimal(12000),
							minPayment: asDecimal(600),
							noInterestPayment: asDecimal(12000),
							interestAmount: asDecimal(0),
							periodEnd: new Date("2026-08-25T00:00:00.000Z"),
							paymentDueDate: new Date("2026-09-14T00:00:00.000Z"),
							isPaid: true,
						},
					],
				},
			],
			loan: [],
			bank: [],
		});
		budgetsService.getProgressForAll.mockResolvedValue([]);

		const summary = await service.getSummary(profile);

		const card = summary.creditOverview.creditCards[0];
		expect(card.nextPaymentDue).toBeNull();
	});

	it("generates pending statements before any read query runs", async () => {
		setupFindMany({
			account: [],
			transaction: [],
			savingsGoal: [],
			creditCard: [],
			loan: [],
			bank: [],
		});
		budgetsService.getProgressForAll.mockResolvedValue([]);

		await service.getSummary(profile);

		const generateOrder = statementGenerationService.generatePending.mock.invocationCallOrder[0];
		const firstReadOrder = prisma.account.findMany.mock.invocationCallOrder[0];
		expect(generateOrder).toBeLessThan(firstReadOrder);
	});

	// ─── T-051: availableCredit + paymentDueDate on CreditCardSummary ───

	it("exposes availableCredit (creditLimit - account.balance) and the frozen paymentDueDate", async () => {
		const paymentDueDate = new Date("2026-11-04T00:00:00.000Z");
		setupFindMany({
			account: [],
			transaction: [],
			savingsGoal: [],
			creditCard: [
				{
					id: "card-1",
					creditLimit: asDecimal(10000),
					account: mockAccount({ id: "cc-acct", type: "CREDIT", balance: asDecimal(3000) }),
					statements: [
						{
							balance: asDecimal(3000),
							minPayment: asDecimal(250),
							noInterestPayment: asDecimal(3000),
							interestAmount: asDecimal(0),
							periodEnd: new Date("2026-10-15T00:00:00.000Z"),
							paymentDueDate,
							isPaid: true,
						},
					],
				},
			],
			loan: [],
			bank: [],
		});
		budgetsService.getProgressForAll.mockResolvedValue([]);

		const summary = await service.getSummary(profile);

		const card = summary.creditOverview.creditCards[0];
		expect(card.availableCredit).toBe(7000);
		expect(card.paymentDueDate).toBe(paymentDueDate.toISOString());
		// Paid statement: nothing is due next
		expect(card.nextPaymentDue).toBeNull();
	});

	it("availableCredit goes negative when over limit and grows with saldo a favor", async () => {
		const makeCard = (id: string, balance: number) => ({
			id,
			creditLimit: asDecimal(10000),
			account: mockAccount({ id: `acct-${id}`, type: "CREDIT", balance: asDecimal(balance) }),
			statements: [],
		});
		setupFindMany({
			account: [],
			transaction: [],
			savingsGoal: [],
			creditCard: [makeCard("over", 12000), makeCard("favor", -1000)],
			loan: [],
			bank: [],
		});
		budgetsService.getProgressForAll.mockResolvedValue([]);

		const summary = await service.getSummary(profile);

		const [over, favor] = summary.creditOverview.creditCards;
		expect(over.availableCredit).toBe(-2000);
		expect(favor.availableCredit).toBe(11000);
		expect(over.paymentDueDate).toBeNull();
		expect(over.noInterestPayment).toBeNull();
	});

	// ─── Sign convention: CREDIT balance = positive debt ───────────────

	it("computes netWorth correctly with positive CREDIT debt (convention: balance > 0 = debt)", async () => {
		setupFindMany({
			account: [
				mockAccount({ id: "a-debit", type: "DEBIT", balance: asDecimal(10000) }),
				mockAccount({ id: "a-credit", type: "CREDIT", balance: asDecimal(3000) }),
				mockAccount({ id: "a-loan", type: "LOAN", balance: asDecimal(5000) }),
			],
			transaction: [],
			savingsGoal: [],
			creditCard: [],
			loan: [],
			bank: [],
		});
		budgetsService.getProgressForAll.mockResolvedValue([]);

		const summary = await service.getSummary(profile);

		// assets = DEBIT 10000; liabilities = CREDIT 3000 + LOAN 5000 = 8000
		expect(summary.netWorth.assets).toBe(10000);
		expect(summary.netWorth.liabilities).toBe(8000);
		expect(summary.netWorth.total).toBe(2000);
	});

	it("accountsDistribution uses absolute balances with positive CREDIT debt", async () => {
		setupFindMany({
			account: [
				mockAccount({ id: "a-debit", type: "DEBIT", balance: asDecimal(10000) }),
				mockAccount({ id: "a-credit", type: "CREDIT", balance: asDecimal(4000) }),
			],
			transaction: [],
			savingsGoal: [],
			creditCard: [],
			loan: [],
			bank: [],
		});
		budgetsService.getProgressForAll.mockResolvedValue([]);

		const summary = await service.getSummary(profile);

		const credit = summary.accountsDistribution.find((d) => d.type === "CREDIT");
		expect(credit?.totalBalance).toBe(4000);
	});
});
