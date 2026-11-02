import { Test, type TestingModule } from "@nestjs/testing";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreditCardsService } from "./credit-cards.service";
import { QueryCreditCardsDto } from "./dto/credit-card.dto";

const Decimal = Prisma.Decimal;

function makeCard(over: Record<string, unknown> = {}) {
	return {
		id: "card-1",
		accountId: "acct-1",
		creditLimit: new Decimal(10000),
		cutDay: 15,
		interestRate: new Decimal("0.36"),
		noInterestMonths: 0,
		paymentDueDays: 20,
		overLimitTolerance: new Decimal(0),
		paymentDay: null,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		account: { id: "acct-1", balance: new Decimal(3000) },
		statements: [] as unknown[],
		...over,
	} as Record<string, unknown>;
}

describe("CreditCardsService (findAll filters)", () => {
	let service: CreditCardsService;
	let prisma: {
		creditCard: { findMany: jest.Mock };
		cardStatement: { findMany: jest.Mock };
	};

	beforeEach(async () => {
		prisma = {
			creditCard: { findMany: jest.fn().mockResolvedValue([]) },
			cardStatement: { findMany: jest.fn().mockResolvedValue([]) },
		};
		const module: TestingModule = await Test.createTestingModule({
			providers: [CreditCardsService, { provide: PrismaService, useValue: prisma }],
		}).compile();
		service = module.get(CreditCardsService);
	});

	it("applies sortBy and order to orderBy", async () => {
		await service.findAllByProfile("p1", { sortBy: "creditLimit", order: "asc" });
		const call = prisma.creditCard.findMany.mock.calls[0][0];
		expect(call.orderBy).toEqual({ creditLimit: "asc" });
	});

	it("defaults to createdAt desc", async () => {
		await service.findAllByProfile("p1", {});
		const call = prisma.creditCard.findMany.mock.calls[0][0];
		expect(call.orderBy).toEqual({ createdAt: "desc" });
		expect(call.where.account).toEqual({ profileId: "p1" });
	});

	it("applies search filter on account name (case-insensitive contains)", async () => {
		await service.findAllByProfile("p1", { search: "visa" });
		const call = prisma.creditCard.findMany.mock.calls[0][0];
		expect(call.where.account).toEqual({
			profileId: "p1",
			name: { contains: "visa", mode: "insensitive" },
		});
	});

	it("omits name filter when search is not provided", async () => {
		await service.findAllByProfile("p1", {});
		const call = prisma.creditCard.findMany.mock.calls[0][0];
		expect(call.where.account).not.toHaveProperty("name");
	});

	it("applies isActive filter on account", async () => {
		await service.findAllByProfile("p1", { isActive: false });
		const call = prisma.creditCard.findMany.mock.calls[0][0];
		expect(call.where.account.isActive).toBe(false);
	});

	it("applies bankId filter on account", async () => {
		await service.findAllByProfile("p1", { bankId: "bank-123" });
		const call = prisma.creditCard.findMany.mock.calls[0][0];
		expect(call.where.account.bankId).toBe("bank-123");
	});

	it("applies hasUnpaidStatement=true with statements some isPaid false", async () => {
		await service.findAllByProfile("p1", { hasUnpaidStatement: true });
		const call = prisma.creditCard.findMany.mock.calls[0][0];
		expect(call.where.statements).toEqual({ some: { isPaid: false } });
	});

	it("applies hasUnpaidStatement=false with statements none isPaid false", async () => {
		await service.findAllByProfile("p1", { hasUnpaidStatement: false });
		const call = prisma.creditCard.findMany.mock.calls[0][0];
		expect(call.where.statements).toEqual({ none: { isPaid: false } });
	});

	it("omits statements filter when hasUnpaidStatement is not provided", async () => {
		await service.findAllByProfile("p1", {});
		const call = prisma.creditCard.findMany.mock.calls[0][0];
		expect(call.where).not.toHaveProperty("statements");
	});

	it("combines multiple filters", async () => {
		await service.findAllByProfile("p1", {
			search: "visa",
			isActive: true,
			bankId: "bank-1",
			hasUnpaidStatement: true,
		});
		const call = prisma.creditCard.findMany.mock.calls[0][0];
		expect(call.where.account).toEqual({
			profileId: "p1",
			name: { contains: "visa", mode: "insensitive" },
			isActive: true,
			bankId: "bank-1",
		});
		expect(call.where.statements).toEqual({ some: { isPaid: false } });
	});
});

describe("QueryCreditCardsDto validation", () => {
	it("rejects an invalid sortBy value", async () => {
		const instance = plainToInstance(QueryCreditCardsDto, { sortBy: "bogus" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "sortBy")).toBe(true);
	});

	it("accepts page and perPage as valid numeric query params", async () => {
		const instance = plainToInstance(QueryCreditCardsDto, { page: "2", perPage: "5" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors).toHaveLength(0);
		expect(instance.page).toBe(2);
		expect(instance.perPage).toBe(5);
	});

	it("rejects page below 1", async () => {
		const instance = plainToInstance(QueryCreditCardsDto, { page: "0" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "page")).toBe(true);
	});

	it("rejects perPage above 100", async () => {
		const instance = plainToInstance(QueryCreditCardsDto, { perPage: "101" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "perPage")).toBe(true);
	});
});

// ─── availableCredit computed field ──────────────────────────────────────

describe("CreditCardsService — availableCredit computed field", () => {
	let service: CreditCardsService;
	let prisma: {
		creditCard: { findMany: jest.Mock; findFirst: jest.Mock };
		cardStatement: { findFirst: jest.Mock; findMany: jest.Mock };
	};

	beforeEach(async () => {
		prisma = {
			creditCard: { findMany: jest.fn(), findFirst: jest.fn() },
			cardStatement: {
				findFirst: jest.fn().mockResolvedValue(null),
				findMany: jest.fn().mockResolvedValue([]),
			},
		};
		const module: TestingModule = await Test.createTestingModule({
			providers: [CreditCardsService, { provide: PrismaService, useValue: prisma }],
		}).compile();
		service = module.get(CreditCardsService);
	});

	it("computes positive availableCredit (10000 - 3000 = 7000)", async () => {
		prisma.creditCard.findMany.mockResolvedValue([
			makeCard({ account: { id: "acct-1", balance: new Decimal(3000) } }),
		]);
		const result = await service.findAllByProfile("p1");
		expect(result.data[0].availableCredit).toBe(7000);
		expect(result.data[0].currentBalance).toBe(3000);
	});

	it("computes fully utilized credit (10000 - 10000 = 0)", async () => {
		prisma.creditCard.findMany.mockResolvedValue([
			makeCard({ account: { id: "acct-1", balance: new Decimal(10000) } }),
		]);
		const result = await service.findAllByProfile("p1");
		expect(result.data[0].availableCredit).toBe(0);
	});

	it("computes over-limit availableCredit (10000 - 12000 = -2000)", async () => {
		prisma.creditCard.findMany.mockResolvedValue([
			makeCard({ account: { id: "acct-1", balance: new Decimal(12000) } }),
		]);
		const result = await service.findAllByProfile("p1");
		expect(result.data[0].availableCredit).toBe(-2000);
	});

	it("computes saldo a favor availableCredit (10000 - (-1000) = 11000)", async () => {
		prisma.creditCard.findMany.mockResolvedValue([
			makeCard({ account: { id: "acct-1", balance: new Decimal(-1000) } }),
		]);
		const result = await service.findAllByProfile("p1");
		expect(result.data[0].availableCredit).toBe(11000);
	});

	it("rounds availableCredit to 2 decimal places (10000 - 3333.33 = 6666.67)", async () => {
		prisma.creditCard.findMany.mockResolvedValue([
			makeCard({ account: { id: "acct-1", balance: new Decimal("3333.33") } }),
		]);
		const result = await service.findAllByProfile("p1");
		expect(result.data[0].availableCredit).toBe(6666.67);
	});

	it("findOne returns availableCredit, currentBalance, and nextPaymentDueDate", async () => {
		const paymentDueDate = new Date("2026-11-04T00:00:00.000Z");
		prisma.creditCard.findFirst.mockResolvedValue(
			makeCard({ account: { id: "acct-1", balance: new Decimal(4000) } }),
		);
		prisma.cardStatement.findFirst.mockResolvedValue({
			paymentDueDate,
			noInterestPayment: new Decimal(3000),
			minPayment: new Decimal(1500),
		});

		const result = await service.findOne("card-1", "p1");
		expect(result.availableCredit).toBe(6000);
		expect(result.currentBalance).toBe(4000);
		expect(result.nextPaymentDueDate).toBe(paymentDueDate);
	});

	it("findOne returns nextPaymentDueDate null when no unpaid statement exists", async () => {
		prisma.creditCard.findFirst.mockResolvedValue(
			makeCard({ account: { id: "acct-1", balance: new Decimal(2000) } }),
		);
		prisma.cardStatement.findFirst.mockResolvedValue(null);

		const result = await service.findOne("card-1", "p1");
		expect(result.availableCredit).toBe(8000);
		expect(result.nextPaymentDueDate).toBeNull();
	});

	it("findAll returns availableCredit for each card in the list", async () => {
		prisma.creditCard.findMany.mockResolvedValue([
			makeCard({
				id: "card-a",
				creditLimit: new Decimal(10000),
				account: { id: "acct-a", balance: new Decimal(2000) },
			}),
			makeCard({
				id: "card-b",
				creditLimit: new Decimal(5000),
				account: { id: "acct-b", balance: new Decimal(5000) },
			}),
		]);
		const result = await service.findAllByProfile("p1");
		expect(result.data[0].availableCredit).toBe(8000);
		expect(result.data[1].availableCredit).toBe(0);
	});
});

// ─── pagination + info ───────────────────────────────────────────────────

describe("CreditCardsService — pagination and info", () => {
	let service: CreditCardsService;
	let prisma: {
		creditCard: { findMany: jest.Mock; findFirst: jest.Mock };
		cardStatement: { findFirst: jest.Mock; findMany: jest.Mock };
	};

	beforeEach(async () => {
		prisma = {
			creditCard: { findMany: jest.fn(), findFirst: jest.fn() },
			cardStatement: {
				findFirst: jest.fn().mockResolvedValue(null),
				findMany: jest.fn().mockResolvedValue([]),
			},
		};
		const module: TestingModule = await Test.createTestingModule({
			providers: [CreditCardsService, { provide: PrismaService, useValue: prisma }],
		}).compile();
		service = module.get(CreditCardsService);
	});

	it("returns empty result with zeroed info when no cards exist", async () => {
		prisma.creditCard.findMany.mockResolvedValue([]);
		const result = await service.findAllByProfile("p1");
		expect(result.data).toHaveLength(0);
		expect(result.info).toEqual({
			totalAvailableCredit: 0,
			totalNoInterestPayment: 0,
			totalMinPayment: 0,
			totalDebt: 0,
			total: 0,
		});
		expect(result.total).toBe(0);
		expect(result.totalPages).toBe(1);
	});

	it("computes info totals across all cards", async () => {
		prisma.creditCard.findMany.mockResolvedValue([
			makeCard({
				id: "card-a",
				creditLimit: new Decimal(10000),
				account: { id: "acct-a", balance: new Decimal(3000) },
			}),
			makeCard({
				id: "card-b",
				creditLimit: new Decimal(5000),
				account: { id: "acct-b", balance: new Decimal(5000) },
			}),
		]);
		prisma.cardStatement.findMany.mockResolvedValue([
			{
				creditCardId: "card-a",
				paymentDueDate: new Date("2026-11-04T00:00:00.000Z"),
				noInterestPayment: new Decimal(2500),
				minPayment: new Decimal(1250),
			},
			{
				creditCardId: "card-b",
				paymentDueDate: new Date("2026-11-10T00:00:00.000Z"),
				noInterestPayment: new Decimal(4000),
				minPayment: new Decimal(2000),
			},
		]);

		const result = await service.findAllByProfile("p1");
		expect(result.info).toEqual({
			totalAvailableCredit: 7000, // (10000-3000) + (5000-5000)
			totalNoInterestPayment: 6500, // 2500 + 4000
			totalMinPayment: 3250, // 1250 + 2000
			totalDebt: 8000, // 3000 + 5000
			total: 2,
		});
	});

	it("info totals ignore cards without unpaid statements", async () => {
		prisma.creditCard.findMany.mockResolvedValue([
			makeCard({
				id: "card-a",
				creditLimit: new Decimal(10000),
				account: { id: "acct-a", balance: new Decimal(3000) },
			}),
		]);
		// No unpaid statements
		prisma.cardStatement.findMany.mockResolvedValue([]);

		const result = await service.findAllByProfile("p1");
		expect(result.info.totalNoInterestPayment).toBe(0);
		expect(result.info.totalMinPayment).toBe(0);
		expect(result.info.totalAvailableCredit).toBe(7000);
		expect(result.info.totalDebt).toBe(3000);
		expect(result.info.total).toBe(1);
	});

	it("paginates data correctly with page and perPage", async () => {
		const cards = Array.from({ length: 5 }, (_, i) =>
			makeCard({
				id: `card-${i + 1}`,
				creditLimit: new Decimal(10000),
				account: { id: `acct-${i + 1}`, balance: new Decimal(1000) },
			}),
		);
		prisma.creditCard.findMany.mockResolvedValue(cards);
		prisma.cardStatement.findMany.mockResolvedValue([]);

		const result = await service.findAllByProfile("p1", { page: 2, perPage: 2 });
		expect(result.data).toHaveLength(2);
		expect(result.data[0].id).toBe("card-3");
		expect(result.data[1].id).toBe("card-4");
		expect(result.page).toBe(2);
		expect(result.perPage).toBe(2);
		expect(result.total).toBe(5);
		expect(result.totalPages).toBe(3); // ceil(5/2)
	});

	it("defaults to page 1, perPage 10", async () => {
		prisma.creditCard.findMany.mockResolvedValue([
			makeCard({ id: "card-1", account: { id: "acct-1", balance: new Decimal(3000) } }),
		]);
		prisma.cardStatement.findMany.mockResolvedValue([]);

		const result = await service.findAllByProfile("p1");
		expect(result.page).toBe(1);
		expect(result.perPage).toBe(10);
	});

	it("totalPages is at least 1 even when total is 0", async () => {
		prisma.creditCard.findMany.mockResolvedValue([]);
		const result = await service.findAllByProfile("p1");
		expect(result.totalPages).toBe(1);
	});
});
