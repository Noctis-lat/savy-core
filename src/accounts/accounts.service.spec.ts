import { BadRequestException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { AccountsService } from "./accounts.service";
import { CreateAccountDto, QueryAccountsDto } from "./dto/account.dto";

describe("AccountsService", () => {
	let service: AccountsService;
	let prisma: {
		account: { findMany: jest.Mock; count: jest.Mock; groupBy: jest.Mock };
	};

	beforeEach(async () => {
		prisma = {
			account: {
				findMany: jest.fn().mockResolvedValue([]),
				count: jest.fn().mockResolvedValue(0),
				groupBy: jest.fn().mockResolvedValue([]),
			},
		};
		const module: TestingModule = await Test.createTestingModule({
			providers: [AccountsService, { provide: PrismaService, useValue: prisma }],
		}).compile();
		service = module.get(AccountsService);
	});

	it("applies sortBy and order to orderBy", async () => {
		await service.findAllByProfile("p1", { sortBy: "balance", order: "asc" });
		const call = prisma.account.findMany.mock.calls[0][0];
		expect(call.orderBy).toEqual({ balance: "asc" });
	});

	it("defaults to createdAt desc and isActive=true", async () => {
		await service.findAllByProfile("p1", {});
		const call = prisma.account.findMany.mock.calls[0][0];
		expect(call.orderBy).toEqual({ createdAt: "desc" });
		expect(call.where.isActive).toBe(true);
	});

	it("passes a bankId filter through", async () => {
		await service.findAllByProfile("p1", { bankId: "bank-1" });
		const call = prisma.account.findMany.mock.calls[0][0];
		expect(call.where.bankId).toBe("bank-1");
	});

	it("applies case-insensitive search on name", async () => {
		await service.findAllByProfile("p1", { search: "checking" });
		const call = prisma.account.findMany.mock.calls[0][0];
		expect(call.where.name).toEqual({ contains: "checking", mode: "insensitive" });
	});

	it("honors isActive=false as a boolean", async () => {
		await service.findAllByProfile("p1", { isActive: false });
		const call = prisma.account.findMany.mock.calls[0][0];
		expect(call.where.isActive).toBe(false);
	});

	it("applies pagination skip and take", async () => {
		await service.findAllByProfile("p1", { page: 3, perPage: 10 });
		const call = prisma.account.findMany.mock.calls[0][0];
		expect(call.skip).toBe(20);
		expect(call.take).toBe(10);
	});

	it("defaults to page 1 and perPage 10", async () => {
		const result = await service.findAllByProfile("p1", {});
		expect(result.page).toBe(1);
		expect(result.perPage).toBe(10);
	});

	it("returns totalPages = 1 when total is 0 (not 0)", async () => {
		const result = await service.findAllByProfile("p1", {});
		expect(result.totalPages).toBe(1);
	});

	it("computes totalPages correctly for multiple pages", async () => {
		prisma.account.count.mockResolvedValue(25);
		const result = await service.findAllByProfile("p1", { perPage: 10 });
		expect(result.total).toBe(25);
		expect(result.totalPages).toBe(3);
	});

	it("returns flat accounts when groupedBy is not set", async () => {
		const result = await service.findAllByProfile("p1", {});
		expect(result.accounts).toBeDefined();
		expect(result.groupedAccounts).toBeUndefined();
	});

	it("groups accounts by type", async () => {
		prisma.account.findMany.mockResolvedValue([
			{ id: "1", type: "DEBIT", name: "Checking" },
			{ id: "2", type: "DEBIT", name: "Savings" },
			{ id: "3", type: "CREDIT", name: "Visa" },
		]);
		prisma.account.count.mockResolvedValue(3);
		const result = await service.findAllByProfile("p1", { groupedBy: "types" });
		expect(result.accounts).toBeUndefined();
		expect(result.groupedAccounts).toHaveLength(2);
		expect(result.groupedAccounts?.[0].key).toBe("DEBIT");
		expect(result.groupedAccounts?.[0].title).toBe("DEBIT");
		expect(result.groupedAccounts?.[0].accounts).toHaveLength(2);
		expect(result.groupedAccounts?.[1].key).toBe("CREDIT");
		expect(result.groupedAccounts?.[1].accounts).toHaveLength(1);
	});

	it("groups accounts by bank with names", async () => {
		prisma.account.findMany.mockResolvedValue([
			{ id: "1", type: "DEBIT", bankId: "b1", bank: { id: "b1", name: "BBVA" } },
			{ id: "2", type: "DEBIT", bankId: "b1", bank: { id: "b1", name: "BBVA" } },
			{ id: "3", type: "CASH", bankId: null, bank: null },
		]);
		prisma.account.count.mockResolvedValue(3);
		const result = await service.findAllByProfile("p1", { groupedBy: "banks" });
		expect(result.groupedAccounts).toHaveLength(2);
		expect(result.groupedAccounts?.[0]).toEqual(
			expect.objectContaining({ key: "b1", title: "BBVA" }),
		);
		expect(result.groupedAccounts?.[1]).toEqual(
			expect.objectContaining({ key: "none", title: "No bank" }),
		);
	});

	it("does not compute info when includeInfo is falsy", async () => {
		await service.findAllByProfile("p1", { includeInfo: false });
		expect(prisma.account.groupBy).not.toHaveBeenCalled();
	});

	it("computes financial info when includeInfo is true", async () => {
		prisma.account.groupBy.mockResolvedValue([
			{ type: "DEBIT", _sum: { balance: 8000000 } },
			{ type: "CASH", _sum: { balance: 2000000 } },
			{ type: "CREDIT", _sum: { balance: 3000000 } },
			{ type: "LOAN", _sum: { balance: 2500000 } },
		]);
		const result = await service.findAllByProfile("p1", { includeInfo: true });
		expect(prisma.account.groupBy).toHaveBeenCalled();
		expect(result.info).toBeDefined();
		expect(result.info?.liquidity).toBe(10000000);
		expect(result.info?.debt).toBe(5500000);
		expect(result.info?.netWorth).toBe(4500000);
	});

	it("normalizes negative liability balances with Math.abs", async () => {
		prisma.account.groupBy.mockResolvedValue([
			{ type: "DEBIT", _sum: { balance: 206000 } },
			{ type: "CREDIT", _sum: { balance: -11700 } },
		]);
		const result = await service.findAllByProfile("p1", { includeInfo: true });
		expect(result.info?.debt).toBe(11700);
		expect(result.info?.netWorth).toBe(194300);
	});
});

describe("QueryAccountsDto validation", () => {
	it("rejects an invalid sortBy value", async () => {
		const instance = plainToInstance(QueryAccountsDto, { sortBy: "bogus" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "sortBy")).toBe(true);
	});

	it("rejects an invalid type value", async () => {
		const instance = plainToInstance(QueryAccountsDto, { type: "SAVINGS" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "type")).toBe(true);
	});

	it("rejects page below 1", async () => {
		const instance = plainToInstance(QueryAccountsDto, { page: 0 });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "page")).toBe(true);
	});

	it("rejects perPage above 100", async () => {
		const instance = plainToInstance(QueryAccountsDto, { perPage: 101 });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "perPage")).toBe(true);
	});
});

describe("AccountsService — entity-superior identity guard", () => {
	let service: AccountsService;
	let prisma: {
		account: { findFirst: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
	};

	const noLinks = { creditCard: null, loan: null, _count: { savingsGoals: 0 } };

	beforeEach(async () => {
		prisma = {
			account: {
				findFirst: jest.fn().mockResolvedValue({ id: "acct-1", profileId: "p1" }),
				findUnique: jest.fn().mockResolvedValue(noLinks),
				update: jest.fn().mockResolvedValue({ id: "acct-1" }),
			},
		};
		const module: TestingModule = await Test.createTestingModule({
			providers: [AccountsService, { provide: PrismaService, useValue: prisma }],
		}).compile();
		service = module.get(AccountsService);
	});

	it.each([
		["credit card", { ...noLinks, creditCard: { id: "card-1" } }],
		["loan", { ...noLinks, loan: { id: "loan-1" } }],
		["savings goal", { ...noLinks, _count: { savingsGoals: 1 } }],
	])("rejects name/color/icon for an account linked to a %s", async (owner, links) => {
		prisma.account.findUnique.mockResolvedValue(links);
		for (const dto of [{ name: "New" }, { color: "#fff" }, { icon: "star" }]) {
			await expect(service.update("acct-1", "p1", dto)).rejects.toThrow(
				new BadRequestException(
					`This account is linked to a ${owner}; edit name, color and icon on the ${owner} instead`,
				),
			);
		}
		expect(prisma.account.update).not.toHaveBeenCalled();
	});

	it("allows other fields on a linked account without checking links", async () => {
		prisma.account.findUnique.mockResolvedValue({ ...noLinks, creditCard: { id: "card-1" } });
		await service.update("acct-1", "p1", { balance: 500 });
		expect(prisma.account.findUnique).not.toHaveBeenCalled();
		expect(prisma.account.update).toHaveBeenCalledWith({
			where: { id: "acct-1" },
			data: { balance: 500 },
		});
	});

	it("allows name/color/icon on a plain account", async () => {
		await service.update("acct-1", "p1", { name: "Wallet", color: "#000", icon: "wallet" });
		expect(prisma.account.update).toHaveBeenCalledWith({
			where: { id: "acct-1" },
			data: { name: "Wallet", color: "#000", icon: "wallet" },
		});
	});
});

describe("AccountsService — create with opening balance", () => {
	let service: AccountsService;
	let prisma: {
		account: { create: jest.Mock; findFirst: jest.Mock; findUnique: jest.Mock };
		transaction: { create: jest.Mock };
		$transaction: jest.Mock;
	};

	beforeEach(async () => {
		prisma = {
			account: {
				create: jest.fn().mockResolvedValue({
					id: "acct-1",
					createdAt: new Date("2026-11-02T19:42:48.000Z"),
				}),
				findFirst: jest.fn(),
				findUnique: jest.fn(),
			},
			transaction: { create: jest.fn().mockResolvedValue({ id: "tx-1" }) },
			$transaction: jest.fn(),
		};
		const module: TestingModule = await Test.createTestingModule({
			providers: [AccountsService, { provide: PrismaService, useValue: prisma }],
		}).compile();
		service = module.get(AccountsService);
	});

	it("creates only the account when balance is 0 (no opening transaction)", async () => {
		const dto = plainToInstance(CreateAccountDto, { name: "Wallet", type: "CASH" });
		await service.create("p1", dto);
		expect(prisma.account.create).toHaveBeenCalledTimes(1);
		expect(prisma.$transaction).not.toHaveBeenCalled();
		expect(prisma.transaction.create).not.toHaveBeenCalled();
	});

	it("creates EXPENSE opening transaction for CREDIT with positive balance", async () => {
		const tx: Record<string, Record<string, jest.Mock>> = {
			account: {
				create: jest
					.fn()
					.mockResolvedValue({ id: "acct-1", createdAt: new Date("2026-11-02T19:42:48.000Z") }),
			},
			transaction: { create: jest.fn().mockResolvedValue({ id: "tx-1" }) },
		};
		prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

		const dto = plainToInstance(CreateAccountDto, {
			name: "Visa",
			type: "CREDIT",
			balance: 200000,
		});
		await service.create("p1", dto);

		expect(tx.transaction.create).toHaveBeenCalledWith({
			data: {
				accountId: "acct-1",
				type: "EXPENSE",
				amount: 200000,
				description: "Opening balance",
				date: new Date("2026-11-02T19:42:48.000Z"),
			},
		});
	});

	it("creates INCOME opening transaction for DEBIT with positive balance", async () => {
		const tx: Record<string, Record<string, jest.Mock>> = {
			account: {
				create: jest
					.fn()
					.mockResolvedValue({ id: "acct-1", createdAt: new Date("2026-11-02T19:42:48.000Z") }),
			},
			transaction: { create: jest.fn().mockResolvedValue({ id: "tx-1" }) },
		};
		prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

		const dto = plainToInstance(CreateAccountDto, {
			name: "Nómina",
			type: "DEBIT",
			balance: 50000,
		});
		await service.create("p1", dto);

		expect(tx.transaction.create).toHaveBeenCalledWith({
			data: {
				accountId: "acct-1",
				type: "INCOME",
				amount: 50000,
				description: "Opening balance",
				date: new Date("2026-11-02T19:42:48.000Z"),
			},
		});
	});

	it("creates INCOME opening transaction for CREDIT with negative balance (saldo a favor)", async () => {
		const tx: Record<string, Record<string, jest.Mock>> = {
			account: {
				create: jest
					.fn()
					.mockResolvedValue({ id: "acct-1", createdAt: new Date("2026-11-02T19:42:48.000Z") }),
			},
			transaction: { create: jest.fn().mockResolvedValue({ id: "tx-1" }) },
		};
		prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

		const dto = plainToInstance(CreateAccountDto, { name: "Visa", type: "CREDIT", balance: -5000 });
		await service.create("p1", dto);

		expect(tx.transaction.create).toHaveBeenCalledWith({
			data: {
				accountId: "acct-1",
				type: "INCOME",
				amount: 5000,
				description: "Opening balance",
				date: new Date("2026-11-02T19:42:48.000Z"),
			},
		});
	});
});
