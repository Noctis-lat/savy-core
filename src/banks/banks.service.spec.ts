import { NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { BanksService } from "./banks.service";
import { QueryBanksDto } from "./dto/bank.dto";
import { QueryIncomeVsExpensesDto } from "./dto/income-vs-expenses.dto";

// Helper to build a Prisma Decimal-like value.
const D = (n: number): { toString(): string; valueOf(): number } => ({
	toString: () => String(n),
	valueOf: () => n,
});

// ─── findAllByProfile ──────────────────────────────────────────────────

describe("BanksService (findAll filters)", () => {
	let service: BanksService;
	let prisma: { bank: { findMany: jest.Mock } };

	beforeEach(async () => {
		prisma = { bank: { findMany: jest.fn().mockResolvedValue([]) } };
		const module: TestingModule = await Test.createTestingModule({
			providers: [BanksService, { provide: PrismaService, useValue: prisma }],
		}).compile();
		service = module.get(BanksService);
	});

	it("applies sortBy and order to orderBy", async () => {
		await service.findAllByProfile("p1", { sortBy: "name", order: "desc" });
		const call = prisma.bank.findMany.mock.calls[0][0];
		expect(call.orderBy).toEqual({ name: "desc" });
	});

	it("defaults to name asc and isActive true", async () => {
		await service.findAllByProfile("p1", {});
		const call = prisma.bank.findMany.mock.calls[0][0];
		expect(call.orderBy).toEqual({ name: "asc" });
		expect(call.where.isActive).toBe(true);
	});

	it("honors isActive=false", async () => {
		await service.findAllByProfile("p1", { isActive: false });
		const call = prisma.bank.findMany.mock.calls[0][0];
		expect(call.where.isActive).toBe(false);
	});

	it("does NOT include accounts when withInfo=false", async () => {
		await service.findAllByProfile("p1", { withInfo: false });
		const call = prisma.bank.findMany.mock.calls[0][0];
		expect(call.include).toBeUndefined();
	});

	it("includes accounts with loan when withInfo=true", async () => {
		prisma.bank.findMany.mockResolvedValue([
			{
				id: "b1",
				name: "BBVA",
				accounts: [makeAccount({ type: "DEBIT", balance: D(1000) })],
			},
		]);
		const result = (await service.findAllByProfile("p1", { withInfo: true })) as Array<
			Record<string, unknown>
		>;
		const call = prisma.bank.findMany.mock.calls[0][0];
		expect(call.include).toBeDefined();
		expect(call.include.accounts).toBeDefined();
		expect(result[0].info).toBeDefined();
		const info = result[0].info as Record<string, unknown>;
		expect(info.liquidity).toBe(100000);
	});
});

// ─── QueryBanksDto validation ──────────────────────────────────────────

describe("QueryBanksDto validation", () => {
	it("rejects an invalid sortBy value", async () => {
		const instance = plainToInstance(QueryBanksDto, { sortBy: "bogus" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "sortBy")).toBe(true);
	});
});

// ─── Helpers ───────────────────────────────────────────────────────────

function makeAccount(overrides: Record<string, unknown> = {}) {
	return {
		id: "acc-1",
		profileId: "profile-1",
		bankId: "bank-1",
		name: "Checking",
		type: "DEBIT",
		currency: "MXN",
		balance: D(1000),
		color: null,
		icon: null,
		isActive: true,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		creditCard: null,
		loan: null,
		...overrides,
	};
}

function makeLoan(overrides: Record<string, unknown> = {}) {
	return {
		id: "loan-1",
		accountId: "acc-3",
		principal: D(200000),
		interestRate: D(0.165),
		termMonths: 36,
		startDate: new Date("2024-01-15T00:00:00.000Z"),
		monthlyPayment: D(6800),
		remaining: D(150000),
		createdAt: new Date("2024-01-15T00:00:00.000Z"),
		updatedAt: new Date("2026-07-01T00:00:00.000Z"),
		...overrides,
	};
}

function makeBank(overrides: Record<string, unknown> = {}) {
	return {
		id: "bank-1",
		profileId: "profile-1",
		name: "BBVA",
		color: "#0d9488",
		logo: "bbva",
		isActive: true,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		accounts: [],
		...overrides,
	};
}

// ─── findOne ───────────────────────────────────────────────────────────

describe("BanksService.findOne", () => {
	let service: BanksService;
	let prisma: { bank: { findFirst: jest.Mock } };

	beforeEach(async () => {
		prisma = { bank: { findFirst: jest.fn() } };
		const module: TestingModule = await Test.createTestingModule({
			providers: [BanksService, { provide: PrismaService, useValue: prisma }],
		}).compile();
		service = module.get(BanksService);
	});

	it("throws NotFoundException when bank doesn't exist", async () => {
		prisma.bank.findFirst.mockResolvedValue(null);
		await expect(service.findOne("nope", "p1")).rejects.toThrow(NotFoundException);
	});

	it("returns plain bank when withInfo=false", async () => {
		const bank = makeBank();
		const { accounts, ...bankData } = bank;
		prisma.bank.findFirst.mockResolvedValue(bankData);
		const result = await service.findOne("bank-1", "p1", false);
		expect(result).toEqual(bankData);
		expect((result as Record<string, unknown>).info).toBeUndefined();
	});

	it("returns bank with info when withInfo=true", async () => {
		prisma.bank.findFirst.mockResolvedValue(
			makeBank({
				accounts: [
					makeAccount({ id: "a1", type: "DEBIT", balance: D(1500) }),
					makeAccount({ id: "a2", type: "CREDIT", balance: D(-500) }),
				],
			}),
		);
		const result = (await service.findOne("bank-1", "p1", true)) as Record<string, unknown>;
		expect(result.info).toBeDefined();
		const info = result.info as Record<string, unknown>;
		expect(info.liquidity).toBe(150000);
		expect(info.debt).toBe(50000);
		expect(info.netWorth).toBe(150000 - 50000);
	});

	it("computes KPIs correctly with mixed account types", async () => {
		prisma.bank.findFirst.mockResolvedValue(
			makeBank({
				accounts: [
					makeAccount({ id: "a1", type: "DEBIT", balance: D(1500) }),
					makeAccount({ id: "a2", type: "CREDIT", balance: D(-500) }),
					makeAccount({
						id: "a3",
						type: "LOAN",
						balance: D(-2000),
						loan: makeLoan({ remaining: D(100000) }),
					}),
					makeAccount({ id: "a4", type: "CASH", balance: D(300) }),
				],
			}),
		);
		const result = (await service.findOne("bank-1", "p1", true)) as Record<string, unknown>;
		const info = result.info as Record<string, unknown>;
		expect(info.netWorth).toBe(150000 - 50000 - 10000000 + 30000);
		expect(info.liquidity).toBe(150000 + 30000);
		expect(info.debt).toBe(50000 + 10000000);
	});

	it("handles empty accounts gracefully with info=true", async () => {
		prisma.bank.findFirst.mockResolvedValue(makeBank({ accounts: [] }));
		const result = (await service.findOne("bank-1", "p1", true)) as Record<string, unknown>;
		const info = result.info as Record<string, unknown>;
		expect(info.netWorth).toBe(0);
		expect(info.liquidity).toBe(0);
		expect(info.debt).toBe(0);
		expect(info.balanceBreakdown).toEqual({ assets: 0, liabilities: 0 });
	});
});

// ─── getIncomeVsExpenses ───────────────────────────────────────────────

describe("BanksService.getIncomeVsExpenses", () => {
	let service: BanksService;
	let prisma: {
		bank: { findFirst: jest.Mock };
		transaction: { findMany: jest.Mock };
	};

	beforeEach(async () => {
		prisma = {
			bank: { findFirst: jest.fn() },
			transaction: { findMany: jest.fn().mockResolvedValue([]) },
		};
		const module: TestingModule = await Test.createTestingModule({
			providers: [BanksService, { provide: PrismaService, useValue: prisma }],
		}).compile();
		service = module.get(BanksService);
	});

	it("throws NotFoundException when bank doesn't exist", async () => {
		prisma.bank.findFirst.mockResolvedValue(null);
		await expect(service.getIncomeVsExpenses("nope", "p1", "month")).rejects.toThrow(
			NotFoundException,
		);
	});

	it("throws UnprocessableEntityException for invalid period", async () => {
		await expect(service.getIncomeVsExpenses("bank-1", "p1", "invalid_period")).rejects.toThrow(
			UnprocessableEntityException,
		);
	});

	it("computes income vs expenses from transactions", async () => {
		prisma.bank.findFirst.mockResolvedValue(makeBank({ accounts: [{ id: "a1" }] }));
		prisma.transaction.findMany.mockResolvedValue([
			{ type: "INCOME", amount: D(2500) },
			{ type: "EXPENSE", amount: D(800) },
			{ type: "EXPENSE", amount: D(1200) },
		]);
		const result = await service.getIncomeVsExpenses("bank-1", "p1", "month");
		expect(result.income).toBe(250000);
		expect(result.expenses).toBe(200000);
		expect(result.period).toMatch(/^\d{4}-\d{2}$/);
		expect(typeof result.periodLabel).toBe("string");
	});

	it("returns zeros when bank has no accounts", async () => {
		prisma.bank.findFirst.mockResolvedValue(makeBank({ accounts: [] }));
		const result = await service.getIncomeVsExpenses("bank-1", "p1", "month");
		expect(result.income).toBe(0);
		expect(result.expenses).toBe(0);
	});
});

// ─── QueryIncomeVsExpensesDto validation ───────────────────────────────

describe("QueryIncomeVsExpensesDto validation", () => {
	it("allows missing period (defaults applied in controller)", async () => {
		const instance = plainToInstance(QueryIncomeVsExpensesDto, {});
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors).toHaveLength(0);
	});

	it("accepts any string (validation is deferred to the service layer as 422)", async () => {
		const instance = plainToInstance(QueryIncomeVsExpensesDto, { period: "invalid_period" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors).toHaveLength(0);
	});
});
