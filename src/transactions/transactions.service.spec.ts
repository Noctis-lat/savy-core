import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
		installmentPlan: Record<string, jest.Mock>;
		cardStatement: Record<string, jest.Mock>;
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
		tx.installmentPlan = { create: jest.fn().mockResolvedValue({}) };
		tx.cardStatement = {
			findFirst: jest.fn().mockResolvedValue(null), // no unpaid statement
			update: jest.fn().mockResolvedValue({}),
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
			installmentPlan: {},
			cardStatement: {},
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
			.mockResolvedValueOnce({
				id: "acc-source",
				type: "DEBIT",
				balance: new Decimal(10000),
				profileId: "p1",
			})
			.mockResolvedValueOnce({
				id: "acc-credit",
				type: "CREDIT",
				balance: new Decimal(9000),
				profileId: "p1",
			});
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
			.mockResolvedValueOnce({
				id: "acc-credit",
				type: "CREDIT",
				balance: new Decimal(9000),
				profileId: "p1",
			})
			.mockResolvedValueOnce({
				id: "acc-debit",
				type: "DEBIT",
				balance: new Decimal(1000),
				profileId: "p1",
			});

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

// ─── InstallmentPlan Creation (T-037) ───────────────────────────────────
//
// Spec: installment-plans/spec.md
// MSI: monthlyAmount = amount / msiMonths, interestRate = null
// MSCI: monthlyAmount via calculateMsciMonthlyAmount, interestRate = rate

describe("TransactionsService — installment plan creation (create)", () => {
	let service: TransactionsService;
	let prisma: {
		account: Record<string, jest.Mock>;
		transaction: Record<string, jest.Mock>;
		category: Record<string, jest.Mock>;
		creditCard: Record<string, jest.Mock>;
		installmentPlan: Record<string, jest.Mock>;
		$transaction: jest.Mock;
	};
	let configService: { get: jest.Mock };
	let calcService: { calculateMsciMonthlyAmount: jest.Mock };

	function setupCreateMocksForPlan(opts: {
		amount: number;
		creditCard?: { creditLimit: Prisma.Decimal; overLimitTolerance: Prisma.Decimal } | null;
	}) {
		const account = {
			id: "acc-credit",
			type: "CREDIT",
			balance: new Decimal(0),
			profileId: "p1",
		};
		const tx: Record<string, Record<string, jest.Mock>> = {};
		tx.account = {
			findFirst: jest.fn().mockResolvedValue(account),
			update: jest.fn().mockResolvedValue(account),
		};
		tx.transaction = {
			create: jest.fn().mockResolvedValue({
				id: "tx-new",
				accountId: account.id,
				type: "EXPENSE",
				amount: new Decimal(opts.amount),
			}),
		};
		tx.category = { findFirst: jest.fn().mockResolvedValue(null) };
		tx.creditCard = {
			findFirst: jest.fn().mockResolvedValue(
				opts.creditCard ?? {
					creditLimit: new Decimal(100000),
					overLimitTolerance: new Decimal(0),
				},
			),
		};
		tx.installmentPlan = { create: jest.fn().mockResolvedValue({ id: "plan-1" }) };
		prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
			return cb(tx);
		});
		return tx;
	}

	beforeEach(async () => {
		configService = { get: jest.fn() };
		configService.get.mockImplementation((key: string) => {
			if (key === "CREDIT_CARD_REACTIVE_ENABLED") return "true";
			return undefined;
		});
		calcService = {
			calculateMsciMonthlyAmount: jest.fn().mockReturnValue(new Decimal(560)),
		};

		prisma = {
			account: {},
			transaction: {},
			category: {},
			creditCard: {},
			installmentPlan: {},
			$transaction: jest.fn(),
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				TransactionsService,
				{ provide: PrismaService, useValue: prisma },
				{ provide: ConfigService, useValue: configService },
				{ provide: CreditCalculationService, useValue: calcService },
			],
		}).compile();
		service = module.get(TransactionsService);
	});

	it("(1) MSI 12 months on 6000 → plan created with type MSI, monthlyAmount 500, interestRate null", async () => {
		const tx = setupCreateMocksForPlan({ amount: 6000 });

		const dto = {
			accountId: "acc-credit",
			destinationAccountId: null,
			categoryId: undefined,
			type: "EXPENSE" as TxType,
			amount: 6000,
			description: "MSI purchase",
			note: undefined,
			date: undefined,
			msiMonths: 12,
			msiType: "MSI" as const,
			msiRate: undefined,
			commissionType: undefined,
		} as unknown as CreateTransactionDto;

		await service.create("p1", dto);

		expect(tx.installmentPlan.create).toHaveBeenCalledTimes(1);
		const planData = tx.installmentPlan.create.mock.calls[0][0].data;
		expect(planData.transactionId).toBe("tx-new");
		expect(planData.type).toBe("MSI");
		expect(planData.totalMonths).toBe(12);
		expect(planData.currentMonth).toBe(0);
		expect(new Decimal(planData.monthlyAmount).toString()).toBe("500");
		expect(planData.interestRate).toBeNull();
		expect(planData.status).toBe("ACTIVE");
	});

	it("(2) MSCI 12 months on 6000 at 0.12 → monthlyAmount via calc service, interestRate stored", async () => {
		const tx = setupCreateMocksForPlan({ amount: 6000 });

		const dto = {
			accountId: "acc-credit",
			destinationAccountId: null,
			categoryId: undefined,
			type: "EXPENSE" as TxType,
			amount: 6000,
			description: "MSCI purchase",
			note: undefined,
			date: undefined,
			msiMonths: 12,
			msiType: "MSCI" as const,
			msiRate: 0.12,
			commissionType: undefined,
		} as unknown as CreateTransactionDto;

		await service.create("p1", dto);

		expect(calcService.calculateMsciMonthlyAmount).toHaveBeenCalledTimes(1);
		const calcArgs = calcService.calculateMsciMonthlyAmount.mock.calls[0];
		expect(new Decimal(calcArgs[0]).toString()).toBe("6000");
		expect(new Decimal(calcArgs[1]).toString()).toBe("0.12");
		expect(calcArgs[2]).toBe(12);

		expect(tx.installmentPlan.create).toHaveBeenCalledTimes(1);
		const planData = tx.installmentPlan.create.mock.calls[0][0].data;
		expect(planData.type).toBe("MSCI");
		expect(planData.interestRate).toBeDefined(); // not null for MSCI
		expect(planData.status).toBe("ACTIVE");
	});

	it("(3) no msiMonths → no installmentPlan.create call", async () => {
		const tx = setupCreateMocksForPlan({ amount: 1000 });

		const dto = {
			accountId: "acc-credit",
			destinationAccountId: null,
			categoryId: undefined,
			type: "EXPENSE" as TxType,
			amount: 1000,
			description: "regular purchase",
			note: undefined,
			date: undefined,
			msiMonths: undefined,
			msiType: undefined,
			msiRate: undefined,
			commissionType: undefined,
		} as unknown as CreateTransactionDto;

		await service.create("p1", dto);

		expect(tx.installmentPlan.create).not.toHaveBeenCalled();
	});

	it("(4) flag off → no plan created even with msiMonths", async () => {
		configService.get.mockImplementation((key: string) => {
			if (key === "CREDIT_CARD_REACTIVE_ENABLED") return "false";
			return undefined;
		});

		const tx = setupCreateMocksForPlan({ amount: 6000 });

		const dto = {
			accountId: "acc-credit",
			destinationAccountId: null,
			categoryId: undefined,
			type: "EXPENSE" as TxType,
			amount: 6000,
			description: "MSI purchase but flag off",
			note: undefined,
			date: undefined,
			msiMonths: 12,
			msiType: "MSI" as const,
			msiRate: undefined,
			commissionType: undefined,
		} as unknown as CreateTransactionDto;

		await service.create("p1", dto);

		expect(tx.installmentPlan.create).not.toHaveBeenCalled();
	});
});

// ─── PAYMENT Waterfall to Statement (T-039) ─────────────────────────────
//
// Spec: statement-generation/spec.md (Payment Waterfall Application)
// On PAYMENT to CREDIT account: find latest unpaid statement, apply waterfall,
// update paidAmount/remainingBalance/isPaid/updatedAt.

describe("TransactionsService — PAYMENT waterfall to statement (create)", () => {
	let service: TransactionsService;
	let prisma: {
		account: Record<string, jest.Mock>;
		transaction: Record<string, jest.Mock>;
		category: Record<string, jest.Mock>;
		creditCard: Record<string, jest.Mock>;
		installmentPlan: Record<string, jest.Mock>;
		cardStatement: Record<string, jest.Mock>;
		$transaction: jest.Mock;
	};
	let configService: { get: jest.Mock };
	let calcService: { applyPaymentWaterfall: jest.Mock };

	beforeEach(async () => {
		configService = { get: jest.fn() };
		configService.get.mockImplementation((key: string) => {
			if (key === "CREDIT_CARD_REACTIVE_ENABLED") return "true";
			return undefined;
		});
		calcService = {
			applyPaymentWaterfall: jest.fn().mockReturnValue({
				interestApplied: new Decimal(300),
				commissionsApplied: new Decimal(200),
				ordinaryApplied: new Decimal(100),
				msiApplied: new Decimal(0),
				msciApplied: new Decimal(0),
				remainder: new Decimal(0),
			}),
		};

		prisma = {
			account: {},
			transaction: {},
			category: {},
			creditCard: {},
			installmentPlan: {},
			cardStatement: {},
			$transaction: jest.fn(),
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				TransactionsService,
				{ provide: PrismaService, useValue: prisma },
				{ provide: ConfigService, useValue: configService },
				{ provide: CreditCalculationService, useValue: calcService },
			],
		}).compile();
		service = module.get(TransactionsService);
	});

	/**
	 * Sets up a PAYMENT from a DEBIT source to a CREDIT destination.
	 * The source account is returned first, the destination second.
	 */
	function setupPaymentMocks(opts: {
		sourceBalance: Prisma.Decimal;
		creditBalance: Prisma.Decimal;
		unpaidStatement?: {
			id: string;
			balance: Prisma.Decimal;
			paidAmount: Prisma.Decimal;
			interestAmount: Prisma.Decimal;
		} | null;
		periodTransactions?: Array<{
			type: string;
			amount: Prisma.Decimal;
			commissionType: string | null;
		}>;
	}) {
		const sourceAccount = {
			id: "acc-debit",
			type: "DEBIT",
			balance: opts.sourceBalance,
			profileId: "p1",
		};
		const creditAccount = {
			id: "acc-credit",
			type: "CREDIT",
			balance: opts.creditBalance,
			profileId: "p1",
		};
		const tx: Record<string, Record<string, jest.Mock>> = {};
		tx.account = {
			findFirst: jest
				.fn()
				.mockResolvedValueOnce(sourceAccount)
				.mockResolvedValueOnce(creditAccount),
			update: jest.fn().mockResolvedValue(sourceAccount),
		};
		tx.transaction = {
			create: jest.fn().mockResolvedValue({ id: "tx-payment", type: "PAYMENT" }),
			findMany: jest.fn().mockResolvedValue(opts.periodTransactions ?? []),
		};
		tx.category = { findFirst: jest.fn().mockResolvedValue(null) };
		tx.creditCard = { findFirst: jest.fn().mockResolvedValue(null) };
		tx.installmentPlan = {
			create: jest.fn().mockResolvedValue({}),
			findMany: jest.fn().mockResolvedValue([]),
		};
		tx.cardStatement = {
			findFirst: jest.fn().mockResolvedValue(opts.unpaidStatement ?? null),
			update: jest.fn().mockResolvedValue({}),
		};
		prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
			return cb(tx);
		});
		return tx;
	}

	it("(1) PAYMENT on CREDIT with unpaid statement → cardStatement.update with paidAmount increment", async () => {
		const tx = setupPaymentMocks({
			sourceBalance: new Decimal(10000),
			creditBalance: new Decimal(5000),
			unpaidStatement: {
				id: "stmt-unpaid",
				balance: new Decimal(5000),
				paidAmount: new Decimal(0),
				interestAmount: new Decimal(300),
			},
			periodTransactions: [{ type: "EXPENSE", amount: new Decimal(2000), commissionType: null }],
		});

		const dto = {
			accountId: "acc-debit",
			destinationAccountId: "acc-credit",
			categoryId: undefined,
			type: "PAYMENT" as TxType,
			amount: 600,
			description: "payment",
			note: undefined,
			date: undefined,
		} as unknown as CreateTransactionDto;

		await service.create("p1", dto);

		expect(tx.cardStatement.update).toHaveBeenCalledTimes(1);
		const updateCall = tx.cardStatement.update.mock.calls[0][0];
		expect(updateCall.where.id).toBe("stmt-unpaid");
		expect(updateCall.data.paidAmount).toEqual({ increment: 600 });
		// 600 paid < 5000 balance → not fully paid
		expect(updateCall.data.isPaid).toBe(false);
		expect(updateCall.data.remainingBalance).toBeDefined();
		expect(updateCall.data.updatedAt).toBeDefined();
	});

	it("(2) PAYMENT on CREDIT with no unpaid statement → no statement update (saldo a favor)", async () => {
		const tx = setupPaymentMocks({
			sourceBalance: new Decimal(10000),
			creditBalance: new Decimal(0),
			unpaidStatement: null,
		});

		const dto = {
			accountId: "acc-debit",
			destinationAccountId: "acc-credit",
			categoryId: undefined,
			type: "PAYMENT" as TxType,
			amount: 500,
			description: "overpayment",
			note: undefined,
			date: undefined,
		} as unknown as CreateTransactionDto;

		await service.create("p1", dto);

		expect(tx.cardStatement.update).not.toHaveBeenCalled();
		expect(tx.cardStatement.findFirst).toHaveBeenCalledTimes(1);
	});

	it("(3) flag off → no waterfall applied to statement", async () => {
		configService.get.mockImplementation((key: string) => {
			if (key === "CREDIT_CARD_REACTIVE_ENABLED") return "false";
			return undefined;
		});

		const tx = setupPaymentMocks({
			sourceBalance: new Decimal(10000),
			creditBalance: new Decimal(5000),
			unpaidStatement: {
				id: "stmt-unpaid",
				balance: new Decimal(5000),
				paidAmount: new Decimal(0),
				interestAmount: new Decimal(300),
			},
		});

		const dto = {
			accountId: "acc-debit",
			destinationAccountId: "acc-credit",
			categoryId: undefined,
			type: "PAYMENT" as TxType,
			amount: 600,
			description: "payment flag off",
			note: undefined,
			date: undefined,
		} as unknown as CreateTransactionDto;

		await service.create("p1", dto);

		expect(tx.cardStatement.update).not.toHaveBeenCalled();
		expect(tx.cardStatement.findFirst).not.toHaveBeenCalled();
		expect(calcService.applyPaymentWaterfall).not.toHaveBeenCalled();
	});
});

// ─── Sign Convention: CREDIT balance = positive debt (bug fix) ──────────
//
// CREDIT accounts store balance as POSITIVE = debt used.
// EXPENSE increases debt (increment), PAYMENT (as destination) decreases debt (decrement).
// INCOME (rare on credit, e.g. refund) decreases debt (decrement).
// DEBIT/CASH/LOAN accounts keep the original sign convention unchanged.

describe("TransactionsService — applyBalance direction by account type (sign convention fix)", () => {
	let service: TransactionsService;
	let prisma: {
		account: Record<string, jest.Mock>;
		transaction: Record<string, jest.Mock>;
		category: Record<string, jest.Mock>;
		creditCard: Record<string, jest.Mock>;
		installmentPlan: Record<string, jest.Mock>;
		cardStatement: Record<string, jest.Mock>;
		$transaction: jest.Mock;
	};
	let configService: { get: jest.Mock };

	beforeEach(async () => {
		configService = { get: jest.fn() };
		configService.get.mockImplementation((key: string) => {
			if (key === "CREDIT_CARD_REACTIVE_ENABLED") return "false";
			return undefined;
		});

		prisma = {
			account: {},
			transaction: {},
			category: {},
			creditCard: {},
			installmentPlan: {},
			cardStatement: {},
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

	function setupBalanceMocks(account: { id: string; type: string; balance: Prisma.Decimal; profileId: string }) {
		const tx: Record<string, Record<string, jest.Mock>> = {};
		tx.account = {
			findFirst: jest.fn().mockResolvedValue(account),
			update: jest.fn().mockResolvedValue(account),
		};
		tx.transaction = {
			create: jest.fn().mockResolvedValue({ id: "tx-1", accountId: account.id, type: "EXPENSE", amount: new Decimal(0) }),
		};
		tx.category = { findFirst: jest.fn().mockResolvedValue(null) };
		tx.creditCard = { findFirst: jest.fn().mockResolvedValue(null) };
		tx.installmentPlan = { create: jest.fn().mockResolvedValue({}) };
		tx.cardStatement = { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) };
		prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
		return tx;
	}

	function buildDto(accountId: string, type: TxType, amount: number, destinationAccountId: string | null = null): CreateTransactionDto {
		return {
			accountId,
			destinationAccountId,
			categoryId: undefined,
			type,
			amount,
			description: "test",
			note: undefined,
			date: undefined,
		} as unknown as CreateTransactionDto;
	}

	// ── CREDIT: EXPENSE increments (more debt) ──

	it("(1) EXPENSE on CREDIT increments balance (more debt)", async () => {
		const tx = setupBalanceMocks({
			id: "acc-credit",
			type: "CREDIT",
			balance: new Decimal(3000),
			profileId: "p1",
		});

		await service.create("p1", buildDto("acc-credit", "EXPENSE", 500));

		const updateCall = tx.account.update.mock.calls.find(
			(c) => c[0].where.id === "acc-credit",
		);
		expect(updateCall).toBeDefined();
		expect(updateCall![0].data.balance).toEqual({ increment: 500 });
	});

	// ── CREDIT: PAYMENT (as destination) decrements (less debt) ──

	it("(2) PAYMENT destination CREDIT decrements balance (less debt)", async () => {
		const sourceAccount = { id: "acc-debit", type: "DEBIT", balance: new Decimal(10000), profileId: "p1" };
		const creditAccount = { id: "acc-credit", type: "CREDIT", balance: new Decimal(5000), profileId: "p1" };

		const tx: Record<string, Record<string, jest.Mock>> = {};
		tx.account = {
			findFirst: jest.fn()
				.mockResolvedValueOnce(sourceAccount)
				.mockResolvedValueOnce(creditAccount),
			update: jest.fn().mockResolvedValue(sourceAccount),
		};
		tx.transaction = { create: jest.fn().mockResolvedValue({ id: "tx-pay", type: "PAYMENT" }) };
		tx.category = { findFirst: jest.fn().mockResolvedValue(null) };
		tx.creditCard = { findFirst: jest.fn().mockResolvedValue(null) };
		tx.installmentPlan = { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) };
		tx.cardStatement = { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() };
		prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

		await service.create("p1", buildDto("acc-debit", "PAYMENT", 2000, "acc-credit"));

		// Find the update for the credit destination account
		const creditUpdate = tx.account.update.mock.calls.find(
			(c) => c[0].where.id === "acc-credit",
		);
		expect(creditUpdate).toBeDefined();
		expect(creditUpdate![0].data.balance).toEqual({ decrement: 2000 });
	});

	// ── CREDIT: INCOME decrements (paying down / refund) ──

	it("(3) INCOME on CREDIT decrements balance (refund / paying down)", async () => {
		const tx = setupBalanceMocks({
			id: "acc-credit",
			type: "CREDIT",
			balance: new Decimal(3000),
			profileId: "p1",
		});

		await service.create("p1", buildDto("acc-credit", "INCOME", 500));

		const updateCall = tx.account.update.mock.calls.find(
			(c) => c[0].where.id === "acc-credit",
		);
		expect(updateCall).toBeDefined();
		expect(updateCall![0].data.balance).toEqual({ decrement: 500 });
	});

	// ── DEBIT: unchanged — EXPENSE decrements ──

	it("(4) EXPENSE on DEBIT decrements balance (unchanged)", async () => {
		const tx = setupBalanceMocks({
			id: "acc-debit",
			type: "DEBIT",
			balance: new Decimal(10000),
			profileId: "p1",
		});

		await service.create("p1", buildDto("acc-debit", "EXPENSE", 500));

		const updateCall = tx.account.update.mock.calls.find(
			(c) => c[0].where.id === "acc-debit",
		);
		expect(updateCall).toBeDefined();
		expect(updateCall![0].data.balance).toEqual({ decrement: 500 });
	});

	// ── DEBIT: unchanged — INCOME increments ──

	it("(5) INCOME on DEBIT increments balance (unchanged)", async () => {
		const tx = setupBalanceMocks({
			id: "acc-debit",
			type: "DEBIT",
			balance: new Decimal(10000),
			profileId: "p1",
		});

		await service.create("p1", buildDto("acc-debit", "INCOME", 500));

		const updateCall = tx.account.update.mock.calls.find(
			(c) => c[0].where.id === "acc-debit",
		);
		expect(updateCall).toBeDefined();
		expect(updateCall![0].data.balance).toEqual({ increment: 500 });
	});

	// ── PAYMENT source DEBIT: decrements (unchanged) ──

	it("(6) PAYMENT source DEBIT decrements balance (unchanged)", async () => {
		const sourceAccount = { id: "acc-debit", type: "DEBIT", balance: new Decimal(10000), profileId: "p1" };
		const creditAccount = { id: "acc-credit", type: "CREDIT", balance: new Decimal(5000), profileId: "p1" };

		const tx: Record<string, Record<string, jest.Mock>> = {};
		tx.account = {
			findFirst: jest.fn()
				.mockResolvedValueOnce(sourceAccount)
				.mockResolvedValueOnce(creditAccount),
			update: jest.fn().mockResolvedValue(sourceAccount),
		};
		tx.transaction = { create: jest.fn().mockResolvedValue({ id: "tx-pay", type: "PAYMENT" }) };
		tx.category = { findFirst: jest.fn().mockResolvedValue(null) };
		tx.creditCard = { findFirst: jest.fn().mockResolvedValue(null) };
		tx.installmentPlan = { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) };
		tx.cardStatement = { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() };
		prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

		await service.create("p1", buildDto("acc-debit", "PAYMENT", 2000, "acc-credit"));

		const debitUpdate = tx.account.update.mock.calls.find(
			(c) => c[0].where.id === "acc-debit",
		);
		expect(debitUpdate).toBeDefined();
		expect(debitUpdate![0].data.balance).toEqual({ decrement: 2000 });
	});

	// ── TRANSFER source CREDIT: increments (more debt on credit) ──

	it("(7) TRANSFER source CREDIT increments balance (more debt)", async () => {
		const creditAccount = { id: "acc-credit", type: "CREDIT", balance: new Decimal(5000), profileId: "p1" };
		const debitAccount = { id: "acc-debit", type: "DEBIT", balance: new Decimal(1000), profileId: "p1" };

		const tx: Record<string, Record<string, jest.Mock>> = {};
		tx.account = {
			findFirst: jest.fn()
				.mockResolvedValueOnce(creditAccount)
				.mockResolvedValueOnce(debitAccount),
			update: jest.fn().mockResolvedValue(creditAccount),
		};
		tx.transaction = { create: jest.fn().mockResolvedValue({ id: "tx-tx", type: "TRANSFER" }) };
		tx.category = { findFirst: jest.fn().mockResolvedValue(null) };
		tx.creditCard = { findFirst: jest.fn().mockResolvedValue(null) };
		tx.installmentPlan = { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) };
		tx.cardStatement = { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() };
		prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

		await service.create("p1", buildDto("acc-credit", "TRANSFER", 2000, "acc-debit"));

		const creditUpdate = tx.account.update.mock.calls.find(
			(c) => c[0].where.id === "acc-credit",
		);
		expect(creditUpdate).toBeDefined();
		expect(creditUpdate![0].data.balance).toEqual({ increment: 2000 });
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
