import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { CardStatementsService } from "../card-statements/card-statements.service";
import type { CreateCardStatementDto } from "../card-statements/dto/card-statement.dto";
import { StatementGenerationService } from "../card-statements/statement-generation.service";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateTransactionDto } from "../transactions/dto/transaction.dto";
import { TransactionsService } from "../transactions/transactions.service";
import { CreditCalculationService } from "./calculations/credit-calculation.service";
import { CreditCardsService } from "./credit-cards.service";

const Decimal = Prisma.Decimal;

/**
 * Feature-flag gating audit (T-056).
 *
 * Contract: CREDIT_CARD_REACTIVE_ENABLED enables reactive WRITE behavior only
 * when it is the exact string "true". Anything else (unset, "TRUE", "1", "")
 * keeps the API identical to the pre-change CRUD behavior. READS are never gated.
 */

/** Flag values that must keep every reactive write path disabled. */
const DISABLED_VALUES: Array<string | undefined> = [undefined, "false", "", "TRUE", "1", "yes"];

function configFor(flag: string | undefined) {
	return {
		get: jest.fn((key: string) => (key === "CREDIT_CARD_REACTIVE_ENABLED" ? flag : undefined)),
	};
}

describe("Reactive flag gating — statement generation", () => {
	async function build(flag: string | undefined) {
		const prisma = {
			creditCard: { findMany: jest.fn().mockResolvedValue([]) },
			$transaction: jest.fn(),
		};
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				StatementGenerationService,
				{ provide: PrismaService, useValue: prisma },
				{ provide: CreditCalculationService, useValue: {} },
				{ provide: ConfigService, useValue: configFor(flag) },
			],
		}).compile();
		return { service: module.get(StatementGenerationService), prisma };
	}

	it.each(DISABLED_VALUES)("generatePending is a no-op for flag=%p", async (flag) => {
		const { service, prisma } = await build(flag);
		await service.generatePending("p1");
		expect(prisma.creditCard.findMany).not.toHaveBeenCalled();
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});

	it("generatePending runs for the exact string 'true' (positive control)", async () => {
		const { service, prisma } = await build("true");
		await service.generatePending("p1");
		expect(prisma.creditCard.findMany).toHaveBeenCalledTimes(1);
	});
});

describe("Reactive flag gating — manual statement create guard", () => {
	async function build(flag: string | undefined) {
		const prisma = {
			creditCard: { findFirst: jest.fn().mockResolvedValue({ id: "card-1" }) },
			cardStatement: { create: jest.fn().mockResolvedValue({ id: "stmt-1" }) },
		};
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				CardStatementsService,
				{ provide: PrismaService, useValue: prisma },
				{ provide: ConfigService, useValue: configFor(flag) },
			],
		}).compile();
		return { service: module.get(CardStatementsService), prisma };
	}

	const manualDto = {
		creditCardId: "card-1",
		periodStart: "2026-09-16",
		periodEnd: "2026-10-15",
		balance: 5000,
		minPayment: 250,
		noInterestPayment: 5000,
		interestAmount: 100,
	} as unknown as CreateCardStatementDto;

	it.each(DISABLED_VALUES)(
		"accepts caller-supplied calculated fields for flag=%p",
		async (flag) => {
			const { service, prisma } = await build(flag);
			await service.create("p1", manualDto);
			expect(prisma.cardStatement.create).toHaveBeenCalledTimes(1);
		},
	);

	it("rejects caller-supplied calculated fields for the exact string 'true' (positive control)", async () => {
		const { service, prisma } = await build("true");
		await expect(service.create("p1", manualDto)).rejects.toThrow(BadRequestException);
		expect(prisma.cardStatement.create).not.toHaveBeenCalled();
	});
});

describe("Reactive flag gating — transactions", () => {
	const creditAccount = {
		id: "acc-credit",
		type: "CREDIT",
		balance: new Decimal(9000),
		profileId: "p1",
	};
	const debitAccount = {
		id: "acc-debit",
		type: "DEBIT",
		balance: new Decimal(50000),
		profileId: "p1",
	};

	async function build(flag: string | undefined) {
		const prisma = { $transaction: jest.fn() };
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				TransactionsService,
				{ provide: PrismaService, useValue: prisma },
				{ provide: ConfigService, useValue: configFor(flag) },
				{
					provide: CreditCalculationService,
					useValue: {
						calculateMsciMonthlyAmount: jest.fn().mockReturnValue(new Decimal(560)),
						applyPaymentWaterfall: jest.fn(),
					},
				},
			],
		}).compile();

		const tx = {
			account: {
				findFirst: jest.fn(async ({ where }: { where: { id: string } }) =>
					where.id === creditAccount.id ? creditAccount : debitAccount,
				),
				update: jest.fn().mockResolvedValue({}),
			},
			transaction: {
				create: jest.fn().mockResolvedValue({ id: "tx-1" }),
				findMany: jest.fn().mockResolvedValue([]),
			},
			category: { findFirst: jest.fn().mockResolvedValue(null) },
			creditCard: {
				findFirst: jest.fn().mockResolvedValue({
					creditLimit: new Decimal(10000),
					overLimitTolerance: new Decimal(0),
				}),
			},
			installmentPlan: {
				create: jest.fn().mockResolvedValue({ id: "plan-1" }),
				findMany: jest.fn().mockResolvedValue([]),
			},
			cardStatement: {
				findFirst: jest.fn().mockResolvedValue({
					id: "stmt-1",
					balance: new Decimal(5000),
					paidAmount: new Decimal(0),
					interestAmount: new Decimal(0),
				}),
				update: jest.fn().mockResolvedValue({}),
			},
		};
		prisma.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) => cb(tx));
		return { service: module.get(TransactionsService), tx };
	}

	// 9000 + 5000 = 14000 > 10000 limit: only rejected when the flag is on.
	const overLimitMsiDto = {
		accountId: "acc-credit",
		destinationAccountId: null,
		type: "EXPENSE",
		amount: 5000,
		msiMonths: 10,
		msiType: "MSI",
	} as unknown as CreateTransactionDto;

	const paymentDto = {
		accountId: "acc-debit",
		destinationAccountId: "acc-credit",
		type: "PAYMENT",
		amount: 600,
	} as unknown as CreateTransactionDto;

	describe.each(DISABLED_VALUES)("flag=%p", (flag) => {
		it("skips over-limit validation and installment plan creation", async () => {
			const { service, tx } = await build(flag);
			await service.create("p1", overLimitMsiDto);
			expect(tx.transaction.create).toHaveBeenCalledTimes(1);
			expect(tx.creditCard.findFirst).not.toHaveBeenCalled();
			expect(tx.installmentPlan.create).not.toHaveBeenCalled();
		});

		it("skips the PAYMENT waterfall to the statement", async () => {
			const { service, tx } = await build(flag);
			await service.create("p1", paymentDto);
			expect(tx.transaction.create).toHaveBeenCalledTimes(1);
			expect(tx.cardStatement.findFirst).not.toHaveBeenCalled();
			expect(tx.cardStatement.update).not.toHaveBeenCalled();
		});
	});

	it("runs over-limit validation for the exact string 'true' (positive control)", async () => {
		const { service, tx } = await build("true");
		await expect(service.create("p1", overLimitMsiDto)).rejects.toThrow(BadRequestException);
		expect(tx.creditCard.findFirst).toHaveBeenCalledTimes(1);
		expect(tx.transaction.create).not.toHaveBeenCalled();
	});

	it("applies the PAYMENT waterfall for the exact string 'true' (positive control)", async () => {
		const { service, tx } = await build("true");
		await service.create("p1", paymentDto);
		expect(tx.cardStatement.update).toHaveBeenCalledTimes(1);
	});
});

describe("Reactive flag gating — reads are never gated", () => {
	it("CreditCardsService returns availableCredit with no ConfigService dependency", async () => {
		const prisma = {
			creditCard: {
				findFirst: jest.fn().mockResolvedValue({
					id: "card-1",
					accountId: "acct-1",
					creditLimit: new Decimal(10000),
					account: { id: "acct-1", balance: new Decimal(3000) },
				}),
			},
			cardStatement: {
				findFirst: jest.fn().mockResolvedValue({ paymentDueDate: new Date(2026, 10, 4) }),
			},
		};
		// Only PrismaService is provided: DI would throw if the read path required the flag.
		const module: TestingModule = await Test.createTestingModule({
			providers: [CreditCardsService, { provide: PrismaService, useValue: prisma }],
		}).compile();

		const card = await module.get(CreditCardsService).findOne("card-1", "p1");

		expect(card.availableCredit).toBe("7000.00");
		expect(card.nextPaymentDueDate).toEqual(new Date(2026, 10, 4));
	});
});
