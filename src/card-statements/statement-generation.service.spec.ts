import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { CreditCalculationService } from "../credit-cards/calculations/credit-calculation.service";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { StatementGenerationService } from "./statement-generation.service";

const Decimal = Prisma.Decimal;

/**
 * Builds a mock tx object with chainable Prisma delegates.
 * Each delegate records calls and returns configurable resolved values.
 */
function createMockTx() {
	const models = ["cardStatement", "transaction", "installmentPlan", "account"];
	const tx: Record<string, Record<string, jest.Mock>> = {};
	for (const model of models) {
		tx[model] = {};
	}
	return tx;
}

describe("StatementGenerationService", () => {
	let service: StatementGenerationService;
	let prisma: {
		creditCard: { findMany: jest.Mock };
		$transaction: jest.Mock;
	};
	let calcService: {
		calculateAverageDailyBalance: jest.Mock;
		calculateInterest: jest.Mock;
		calculatePngi: jest.Mock;
		calculateMinimumPayment: jest.Mock;
		calculatePaymentDueDate: jest.Mock;
	};
	let configService: { get: jest.Mock };

	beforeEach(async () => {
		calcService = {
			calculateAverageDailyBalance: jest.fn().mockReturnValue(new Decimal(1000)),
			calculateInterest: jest.fn().mockReturnValue({
				preIva: new Decimal(100),
				iva: new Decimal(16),
				total: new Decimal(116),
			}),
			calculatePngi: jest.fn().mockReturnValue(new Decimal(1000)),
			calculateMinimumPayment: jest.fn().mockReturnValue(new Decimal(250)),
			calculatePaymentDueDate: jest.fn().mockReturnValue(new Date(2026, 10, 4)),
		};
		configService = { get: jest.fn() };
		prisma = {
			creditCard: { findMany: jest.fn().mockResolvedValue([]) },
			$transaction: jest.fn(),
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				StatementGenerationService,
				{ provide: PrismaService, useValue: prisma },
				{ provide: CreditCalculationService, useValue: calcService },
				{ provide: ConfigService, useValue: configService },
			],
		}).compile();
		service = module.get(StatementGenerationService);
	});

	describe("generatePending", () => {
		it("is a no-op when CREDIT_CARD_REACTIVE_ENABLED is false", async () => {
			configService.get.mockImplementation((key: string) => {
				if (key === "CREDIT_CARD_REACTIVE_ENABLED") return "false";
				if (key === "CREDIT_CARD_MAX_CATCH_UP_PERIODS") return "12";
				return undefined;
			});
			prisma.creditCard.findMany.mockResolvedValue([{ id: "card-1", accountId: "acc-1" }]);

			await service.generatePending("profile-1");

			// Must NOT query credit cards when flag is off
			expect(prisma.creditCard.findMany).not.toHaveBeenCalled();
			expect(prisma.$transaction).not.toHaveBeenCalled();
		});

		it("generates a single statement when one cut date has passed with no prior statement", async () => {
			configService.get.mockImplementation((key: string) => {
				if (key === "CREDIT_CARD_REACTIVE_ENABLED") return "true";
				if (key === "CREDIT_CARD_MAX_CATCH_UP_PERIODS") return "12";
				return undefined;
			});

			const card = {
				id: "card-1",
				accountId: "acc-1",
				cutDay: 15,
				interestRate: new Decimal(0.36),
				creditLimit: new Decimal(20000),
				paymentDueDays: 20,
			};
			prisma.creditCard.findMany.mockResolvedValue([card]);

			const tx = createMockTx();
			tx.cardStatement = {
				findFirst: jest.fn().mockResolvedValue(null), // no prior statement
				findUnique: jest.fn().mockResolvedValue(null), // idempotency check: none
				create: jest.fn().mockResolvedValue({ id: "stmt-1" }),
			};
			tx.transaction = {
				findMany: jest.fn().mockResolvedValue([]), // no transactions in period
				updateMany: jest.fn().mockResolvedValue({ count: 0 }),
			};
			tx.installmentPlan = {
				findMany: jest.fn().mockResolvedValue([]),
				update: jest.fn().mockResolvedValue({}),
			};
			tx.account = {
				findFirst: jest.fn().mockResolvedValue({ id: "acc-1", balance: new Decimal(5000) }),
			};

			// $transaction receives a callback; invoke it with our tx mock
			prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
				return cb(tx);
			});

			// Current date is after Oct 15 2026 cut
			const realDateNow = Date.now;
			Date.now = jest.fn(() => new Date(2026, 9, 16).getTime());
			try {
				await service.generatePending("profile-1");
			} finally {
				Date.now = realDateNow;
			}

			expect(tx.cardStatement.create).toHaveBeenCalledTimes(1);
			const createCall = tx.cardStatement.create.mock.calls[0][0];
			expect(createCall.data.isGenerated).toBe(true);
			expect(createCall.data.creditCardId).toBe("card-1");
		});

		it("generates 3 statements when 3 cut dates have been missed", async () => {
			configService.get.mockImplementation((key: string) => {
				if (key === "CREDIT_CARD_REACTIVE_ENABLED") return "true";
				if (key === "CREDIT_CARD_MAX_CATCH_UP_PERIODS") return "12";
				return undefined;
			});

			const card = {
				id: "card-1",
				accountId: "acc-1",
				cutDay: 15,
				interestRate: new Decimal(0.36),
				creditLimit: new Decimal(20000),
				paymentDueDays: 20,
			};
			prisma.creditCard.findMany.mockResolvedValue([card]);

			const tx = createMockTx();
			// Last statement ended July 15 2026; now is Oct 20 2026 → 3 missed: Aug 15, Sep 15, Oct 15
			tx.cardStatement = {
				findFirst: jest.fn().mockResolvedValue({
					periodEnd: new Date(2026, 6, 15), // July 15
					paidAmount: new Decimal(0),
					noInterestPayment: new Decimal(1000),
				}),
				findUnique: jest.fn().mockResolvedValue(null),
				create: jest.fn().mockResolvedValue({
					id: "stmt-new",
					paidAmount: new Decimal(0),
					noInterestPayment: new Decimal(1000),
				}),
			};
			tx.transaction = {
				findMany: jest.fn().mockResolvedValue([]),
				updateMany: jest.fn().mockResolvedValue({ count: 0 }),
				create: jest.fn().mockResolvedValue({ id: "tx-interest" }),
			};
			tx.installmentPlan = {
				findMany: jest.fn().mockResolvedValue([]),
				update: jest.fn().mockResolvedValue({}),
			};
			tx.account = {
				findFirst: jest.fn().mockResolvedValue({ id: "acc-1", balance: new Decimal(5000) }),
				update: jest.fn().mockResolvedValue({}),
			};

			prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
				return cb(tx);
			});

			const realDateNow = Date.now;
			Date.now = jest.fn(() => new Date(2026, 9, 20).getTime());
			try {
				await service.generatePending("profile-1");
			} finally {
				Date.now = realDateNow;
			}

			expect(tx.cardStatement.create).toHaveBeenCalledTimes(3);
		});

		it("skips a period that already has a statement (idempotency)", async () => {
			configService.get.mockImplementation((key: string) => {
				if (key === "CREDIT_CARD_REACTIVE_ENABLED") return "true";
				if (key === "CREDIT_CARD_MAX_CATCH_UP_PERIODS") return "12";
				return undefined;
			});

			const card = {
				id: "card-1",
				accountId: "acc-1",
				cutDay: 15,
				interestRate: new Decimal(0.36),
				creditLimit: new Decimal(20000),
				paymentDueDays: 20,
			};
			prisma.creditCard.findMany.mockResolvedValue([card]);

			const existingStatement = { id: "stmt-existing", periodStart: new Date(2026, 8, 16) };
			const tx = createMockTx();
			tx.cardStatement = {
				findFirst: jest.fn().mockResolvedValue(null), // no prior latest
				// Idempotency: findUnique returns an existing statement for that period
				findUnique: jest.fn().mockResolvedValue(existingStatement),
				create: jest.fn().mockResolvedValue({ id: "stmt-new" }),
			};
			tx.transaction = {
				findMany: jest.fn().mockResolvedValue([]),
				updateMany: jest.fn().mockResolvedValue({ count: 0 }),
			};
			tx.installmentPlan = {
				findMany: jest.fn().mockResolvedValue([]),
				update: jest.fn().mockResolvedValue({}),
			};
			tx.account = {
				findFirst: jest.fn().mockResolvedValue({ id: "acc-1", balance: new Decimal(5000) }),
			};

			prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
				return cb(tx);
			});

			const realDateNow = Date.now;
			Date.now = jest.fn(() => new Date(2026, 9, 16).getTime());
			try {
				await service.generatePending("profile-1");
			} finally {
				Date.now = realDateNow;
			}

			// No new statement should be created because the only period already exists
			expect(tx.cardStatement.create).not.toHaveBeenCalled();
		});

		it("uses last day of month when cutDay exceeds month length (cutDay 31 in February)", async () => {
			configService.get.mockImplementation((key: string) => {
				if (key === "CREDIT_CARD_REACTIVE_ENABLED") return "true";
				if (key === "CREDIT_CARD_MAX_CATCH_UP_PERIODS") return "12";
				return undefined;
			});

			const card = {
				id: "card-1",
				accountId: "acc-1",
				cutDay: 31,
				interestRate: new Decimal(0.36),
				creditLimit: new Decimal(20000),
				paymentDueDays: 20,
			};
			prisma.creditCard.findMany.mockResolvedValue([card]);

			const tx = createMockTx();
			tx.cardStatement = {
				findFirst: jest.fn().mockResolvedValue(null),
				findUnique: jest.fn().mockResolvedValue(null),
				create: jest.fn().mockResolvedValue({ id: "stmt-1" }),
			};
			tx.transaction = {
				findMany: jest.fn().mockResolvedValue([]),
				updateMany: jest.fn().mockResolvedValue({ count: 0 }),
			};
			tx.installmentPlan = {
				findMany: jest.fn().mockResolvedValue([]),
				update: jest.fn().mockResolvedValue({}),
			};
			tx.account = {
				findFirst: jest.fn().mockResolvedValue({ id: "acc-1", balance: new Decimal(5000) }),
			};

			prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
				return cb(tx);
			});

			// Now is Mar 1 2026 → Feb period (cut day 31 → Feb 28) should be generated
			const realDateNow = Date.now;
			Date.now = jest.fn(() => new Date(2026, 2, 1).getTime());
			try {
				await service.generatePending("profile-1");
			} finally {
				Date.now = realDateNow;
			}

			expect(tx.cardStatement.create).toHaveBeenCalled();
			const createCall = tx.cardStatement.create.mock.calls[0][0];
			// periodEnd should be Feb 28 (not Mar 3)
			const periodEnd = new Date(createCall.data.periodEnd);
			expect(periodEnd.getDate()).toBe(28);
			expect(periodEnd.getMonth()).toBe(1); // February (0-indexed)
		});

		it("generates a statement even when there are no transactions in the period", async () => {
			configService.get.mockImplementation((key: string) => {
				if (key === "CREDIT_CARD_REACTIVE_ENABLED") return "true";
				if (key === "CREDIT_CARD_MAX_CATCH_UP_PERIODS") return "12";
				return undefined;
			});

			const card = {
				id: "card-1",
				accountId: "acc-1",
				cutDay: 15,
				interestRate: new Decimal(0.36),
				creditLimit: new Decimal(20000),
				paymentDueDays: 20,
			};
			prisma.creditCard.findMany.mockResolvedValue([card]);

			const tx = createMockTx();
			tx.cardStatement = {
				findFirst: jest.fn().mockResolvedValue(null),
				findUnique: jest.fn().mockResolvedValue(null),
				create: jest.fn().mockResolvedValue({ id: "stmt-1" }),
			};
			tx.transaction = {
				findMany: jest.fn().mockResolvedValue([]), // empty period
				updateMany: jest.fn().mockResolvedValue({ count: 0 }),
			};
			tx.installmentPlan = {
				findMany: jest.fn().mockResolvedValue([]),
				update: jest.fn().mockResolvedValue({}),
			};
			tx.account = {
				findFirst: jest.fn().mockResolvedValue({ id: "acc-1", balance: new Decimal(5000) }),
			};

			prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
				return cb(tx);
			});

			const realDateNow = Date.now;
			Date.now = jest.fn(() => new Date(2026, 9, 16).getTime());
			try {
				await service.generatePending("profile-1");
			} finally {
				Date.now = realDateNow;
			}

			// Statement still created with carried-forward balance
			expect(tx.cardStatement.create).toHaveBeenCalledTimes(1);
			// No transactions to link, so updateMany is skipped
			expect(tx.transaction.updateMany).not.toHaveBeenCalled();
			// Calculation service called for the empty period
			expect(calcService.calculateAverageDailyBalance).toHaveBeenCalled();
		});
	});
});
