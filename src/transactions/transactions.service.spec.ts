import { ConfigService } from "@nestjs/config";
import { BadRequestException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreditCalculationService } from "../credit-cards/calculations/credit-calculation.service";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTransactionDto, QueryTransactionsDto } from "./dto/transaction.dto";
import { TransactionsService } from "./transactions.service";

const Decimal = Prisma.Decimal;

/** Type alias for the DTO's TransactionType enum (not exported from the DTO module). */
type TxType = "INCOME" | "EXPENSE" | "TRANSFER" | "PAYMENT";

describe("TransactionsService", () => {
	let service: TransactionsService;
	let prisma: {
		account: { findMany: jest.Mock };
		transaction: { findMany: jest.Mock; count: jest.Mock };
	};

	beforeEach(async () => {
		prisma = {
			account: { findMany: jest.fn().mockResolvedValue([{ id: "a-1" }]) },
			transaction: {
				findMany: jest.fn().mockResolvedValue([]),
				count: jest.fn().mockResolvedValue(0),
			},
		};
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				TransactionsService,
				{ provide: PrismaService, useValue: prisma },
				{ provide: ConfigService, useValue: { get: jest.fn() } },
				{ provide: CreditCalculationService, useValue: {} },
			],
		}).compile();
		service = module.get(TransactionsService);
	});

	it("applies sortBy and order to the findMany orderBy", async () => {
		await service.findAllByProfile("p1", { sortBy: "amount", order: "asc" });

		const call = prisma.transaction.findMany.mock.calls[0][0];
		expect(call.orderBy).toEqual({ amount: "asc" });
	});

	it("defaults sortBy=date and order=desc", async () => {
		await service.findAllByProfile("p1", {});

		const call = prisma.transaction.findMany.mock.calls[0][0];
		expect(call.orderBy).toEqual({ date: "desc" });
	});

	it("includes totalPages in the result", async () => {
		prisma.transaction.count.mockResolvedValue(120);
		const result = await service.findAllByProfile("p1", { limit: 50 });
		expect(result.totalPages).toBe(3);
	});

	it("scopes transactions to a bankId by intersecting owned accounts", async () => {
		prisma.account.findMany
			.mockResolvedValueOnce([{ id: "a-1" }, { id: "a-2" }]) // owned
			.mockResolvedValueOnce([{ id: "a-2" }]); // accounts of the bank
		await service.findAllByProfile("p1", { bankId: "bank-1" });

		const call = prisma.transaction.findMany.mock.calls[0][0];
		expect(call.where.AND[0].OR[0].accountId.in).toEqual(["a-2"]);
	});

	it("applies search as a case-insensitive contains on description", async () => {
		await service.findAllByProfile("p1", { search: "grocery" });

		const call = prisma.transaction.findMany.mock.calls[0][0];
		expect(call.where.AND).toContainEqual({
			description: { contains: "grocery", mode: "insensitive" },
		});
	});
});

// ─── Over-Limit Validation (T-035) ──────────────────────────────────────
//
// Spec: over-limit-validation/spec.md
// Feature flag: CREDIT_CARD_REACTIVE_ENABLED gates all validation.
// When the flag is off, no over-limit check runs (current CRUD-only behavior).

describe("TransactionsService — over-limit validation (create)", () => {
	let service: TransactionsService;
	let prisma: {
		account: Record<string, jest.Mock>;
		transaction: Record<string, jest.Mock>;
		category: Record<string, jest.Mock>;
		creditCard: Record<string, jest.Mock>;
		$transaction: jest.Mock;
	};
	let configService: { get: jest.Mock };

	/** Builds a CreateTransactionDto-like input (plain object — service reads fields directly). */
	function buildExpenseDto(accountId: string, amount: number): CreateTransactionDto {
		return {
			accountId,
			destinationAccountId: null,
			categoryId: undefined,
			type: "EXPENSE" as TxType,
			amount,
			description: "test",
			note: undefined,
			date: undefined,
		} as unknown as CreateTransactionDto;
	}

	/**
	 * Wires a mock tx for the create() flow with an account, optional credit card,
	 * and standard transaction.create + account.update delegates.
	 */
	function setupCreateMocks(opts: {
		account: { id: string; type: string; balance: Prisma.Decimal; profileId: string };
		creditCard?: { creditLimit: Prisma.Decimal; overLimitTolerance: Prisma.Decimal } | null;
		createdTxId?: string;
	}) {
		const tx: Record<string, Record<string, jest.Mock>> = {};
		tx.account = {
			findFirst: jest.fn().mockResolvedValue(opts.account),
			update: jest.fn().mockResolvedValue(opts.account),
		};
		tx.transaction = {
			create: jest.fn().mockResolvedValue({
				id: opts.createdTxId ?? "tx-new",
				accountId: opts.account.id,
				type: "EXPENSE",
				amount: new Decimal(0),
			}),
		};
		tx.category = {
			findFirst: jest.fn().mockResolvedValue(null),
		};
		tx.creditCard = {
			findFirst: jest.fn().mockResolvedValue(opts.creditCard ?? null),
		};
		prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
			return cb(tx);
		});
		return tx;
	}

	beforeEach(async () => {
		configService = { get: jest.fn() };
		// Default: reactive enabled
		configService.get.mockImplementation((key: string) => {
			if (key === "CREDIT_CARD_REACTIVE_ENABLED") return "true";
			return undefined;
		});

		prisma = {
			account: {},
			transaction: {},
			category: {},
			creditCard: {},
			$transaction: jest.fn(),
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				TransactionsService,
				{ provide: PrismaService, useValue: prisma },
				{ provide: ConfigService, useValue: configService },
				{ provide: CreditCalculationService, useValue: {} },
			],
		}).compile();
		service = module.get(TransactionsService);
	});

	it("(1) EXPENSE on CREDIT within limit is accepted", async () => {
		const tx = setupCreateMocks({
			account: {
				id: "acc-credit",
				type: "CREDIT",
				balance: new Decimal(3000),
				profileId: "p1",
			},
			creditCard: { creditLimit: new Decimal(10000), overLimitTolerance: new Decimal(0) },
		});

		await service.create("p1", buildExpenseDto("acc-credit", 5000));

		expect(tx.transaction.create).toHaveBeenCalledTimes(1);
	});

	it("(2) EXPENSE on CREDIT at exact limit is accepted", async () => {
		const tx = setupCreateMocks({
			account: {
				id: "acc-credit",
				type: "CREDIT",
				balance: new Decimal(3000),
				profileId: "p1",
			},
			creditCard: { creditLimit: new Decimal(10000), overLimitTolerance: new Decimal(0) },
		});

		await service.create("p1", buildExpenseDto("acc-credit", 7000));

		expect(tx.transaction.create).toHaveBeenCalledTimes(1);
	});

	it("(3) EXPENSE on CREDIT over limit is rejected with BadRequestException", async () => {
		setupCreateMocks({
			account: {
				id: "acc-credit",
				type: "CREDIT",
				balance: new Decimal(3000),
				profileId: "p1",
			},
			creditCard: { creditLimit: new Decimal(10000), overLimitTolerance: new Decimal(0) },
		});

		await expect(service.create("p1", buildExpenseDto("acc-credit", 8000))).rejects.toThrow(
			BadRequestException,
		);
	});

	it("(4) EXPENSE exceeding limit+tolerance is rejected", async () => {
		setupCreateMocks({
			account: {
				id: "acc-credit",
				type: "CREDIT",
				balance: new Decimal(9500),
				profileId: "p1",
			},
			creditCard: { creditLimit: new Decimal(10000), overLimitTolerance: new Decimal(100) },
		});

		// 9500 + 700 = 10200 > 10000 + 100 = 10100
		await expect(service.create("p1", buildExpenseDto("acc-credit", 700))).rejects.toThrow(
			BadRequestException,
		);
	});

	it("(5) EXPENSE within tolerance is accepted", async () => {
		const tx = setupCreateMocks({
			account: {
				id: "acc-credit",
				type: "CREDIT",
				balance: new Decimal(9500),
				profileId: "p1",
			},
			creditCard: { creditLimit: new Decimal(10000), overLimitTolerance: new Decimal(1000) },
		});

		// 9500 + 700 = 10200 <= 10000 + 1000 = 11000
		await service.create("p1", buildExpenseDto("acc-credit", 700));

		expect(tx.transaction.create).toHaveBeenCalledTimes(1);
	});

	it("(6) EXPENSE on DEBIT bypasses over-limit validation", async () => {
		const tx = setupCreateMocks({
			account: {
				id: "acc-debit",
				type: "DEBIT",
				balance: new Decimal(100),
				profileId: "p1",
			},
			creditCard: null, // no credit card for DEBIT
		});

		// 5000 expense on 100 balance → would be -4900; no credit limit to check
		await service.create("p1", buildExpenseDto("acc-debit", 5000));

		expect(tx.transaction.create).toHaveBeenCalledTimes(1);
		expect(tx.creditCard.findFirst).not.toHaveBeenCalled();
	});

	it("(7) PAYMENT on CREDIT bypasses over-limit validation", async () => {
		const tx = setupCreateMocks({
			account: {
				id: "acc-source",
				type: "DEBIT",
				balance: new Decimal(10000),
				profileId: "p1",
			},
			creditCard: null,
		});
		// PAYMENT needs a destination CREDIT account
		tx.account.findFirst
			.mockResolvedValueOnce({ id: "acc-source", type: "DEBIT", balance: new Decimal(10000), profileId: "p1" })
			.mockResolvedValueOnce({ id: "acc-credit", type: "CREDIT", balance: new Decimal(9000), profileId: "p1" });
		tx.creditCard.findFirst = jest.fn().mockResolvedValue({
			creditLimit: new Decimal(10000),
			overLimitTolerance: new Decimal(0),
		});

		const dto = {
			accountId: "acc-source",
			destinationAccountId: "acc-credit",
			type: "PAYMENT" as TxType,
			amount: 5000,
		} as unknown as CreateTransactionDto;

		await service.create("p1", dto);

		expect(tx.transaction.create).toHaveBeenCalledTimes(1);
		// PAYMENT must not trigger over-limit check on the credit destination
		expect(tx.creditCard.findFirst).not.toHaveBeenCalled();
	});

	it("(8) TRANSFER from CREDIT bypasses over-limit validation", async () => {
		const tx = setupCreateMocks({
			account: {
				id: "acc-credit",
				type: "CREDIT",
				balance: new Decimal(9000),
				profileId: "p1",
			},
			creditCard: {
				creditLimit: new Decimal(10000),
				overLimitTolerance: new Decimal(0),
			},
		});
		tx.account.findFirst
			.mockResolvedValueOnce({ id: "acc-credit", type: "CREDIT", balance: new Decimal(9000), profileId: "p1" })
			.mockResolvedValueOnce({ id: "acc-debit", type: "DEBIT", balance: new Decimal(1000), profileId: "p1" });

		const dto = {
			accountId: "acc-credit",
			destinationAccountId: "acc-debit",
			type: "TRANSFER" as TxType,
			amount: 2000,
		} as unknown as CreateTransactionDto;

		await service.create("p1", dto);

		expect(tx.transaction.create).toHaveBeenCalledTimes(1);
		expect(tx.creditCard.findFirst).not.toHaveBeenCalled();
	});

	it("(9) saldo a favor spending within limit is accepted", async () => {
		const tx = setupCreateMocks({
			account: {
				id: "acc-credit",
				type: "CREDIT",
				balance: new Decimal(-1000), // saldo a favor
				profileId: "p1",
			},
			creditCard: { creditLimit: new Decimal(10000), overLimitTolerance: new Decimal(0) },
		});

		// -1000 + 5000 = 4000 <= 10000
		await service.create("p1", buildExpenseDto("acc-credit", 5000));

		expect(tx.transaction.create).toHaveBeenCalledTimes(1);
	});

	it("(10) flag off → no over-limit validation (balance exceeds limit accepted)", async () => {
		configService.get.mockImplementation((key: string) => {
			if (key === "CREDIT_CARD_REACTIVE_ENABLED") return "false";
			return undefined;
		});

		const tx = setupCreateMocks({
			account: {
				id: "acc-credit",
				type: "CREDIT",
				balance: new Decimal(9000),
				profileId: "p1",
			},
			creditCard: { creditLimit: new Decimal(10000), overLimitTolerance: new Decimal(0) },
		});

		// 9000 + 5000 = 14000 > 10000 → would be rejected if flag on, but flag is off
		await service.create("p1", buildExpenseDto("acc-credit", 5000));

		expect(tx.transaction.create).toHaveBeenCalledTimes(1);
		expect(tx.creditCard.findFirst).not.toHaveBeenCalled();
	});
});

describe("QueryTransactionsDto validation", () => {
	it("rejects an invalid sortBy value", async () => {
		const instance = plainToInstance(QueryTransactionsDto, { sortBy: "invalid" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		const fieldErrors = errors.filter((e) => e.property === "sortBy");
		expect(fieldErrors.length).toBeGreaterThan(0);
	});

	it("rejects an invalid order value", async () => {
		const instance = plainToInstance(QueryTransactionsDto, { order: "sideways" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		const fieldErrors = errors.filter((e) => e.property === "order");
		expect(fieldErrors.length).toBeGreaterThan(0);
	});
});
