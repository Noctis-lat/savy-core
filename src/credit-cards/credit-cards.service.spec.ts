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
	let prisma: { creditCard: { findMany: jest.Mock } };

	beforeEach(async () => {
		prisma = { creditCard: { findMany: jest.fn().mockResolvedValue([]) } };
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
});

describe("QueryCreditCardsDto validation", () => {
	it("rejects an invalid sortBy value", async () => {
		const instance = plainToInstance(QueryCreditCardsDto, { sortBy: "bogus" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "sortBy")).toBe(true);
	});
});

// ─── T-043: availableCredit computed field ──────────────────────────────

describe("CreditCardsService — availableCredit computed field", () => {
	let service: CreditCardsService;
	let prisma: {
		creditCard: { findMany: jest.Mock; findFirst: jest.Mock };
		cardStatement: { findFirst: jest.Mock };
	};

	beforeEach(async () => {
		prisma = {
			creditCard: { findMany: jest.fn(), findFirst: jest.fn() },
			cardStatement: { findFirst: jest.fn().mockResolvedValue(null) },
		};
		const module: TestingModule = await Test.createTestingModule({
			providers: [CreditCardsService, { provide: PrismaService, useValue: prisma }],
		}).compile();
		service = module.get(CreditCardsService);
	});

	it("computes positive availableCredit (10000 - 3000 = 7000.00)", async () => {
		prisma.creditCard.findMany.mockResolvedValue([
			makeCard({ account: { id: "acct-1", balance: new Decimal(3000) } }),
		]);
		const result = await service.findAllByProfile("p1");
		expect(result[0].availableCredit).toBe("7000.00");
		expect(result[0].currentBalance).toBe("3000.00");
	});

	it("computes fully utilized credit (10000 - 10000 = 0.00)", async () => {
		prisma.creditCard.findMany.mockResolvedValue([
			makeCard({ account: { id: "acct-1", balance: new Decimal(10000) } }),
		]);
		const result = await service.findAllByProfile("p1");
		expect(result[0].availableCredit).toBe("0.00");
	});

	it("computes over-limit availableCredit (10000 - 12000 = -2000.00)", async () => {
		prisma.creditCard.findMany.mockResolvedValue([
			makeCard({ account: { id: "acct-1", balance: new Decimal(12000) } }),
		]);
		const result = await service.findAllByProfile("p1");
		expect(result[0].availableCredit).toBe("-2000.00");
	});

	it("computes saldo a favor availableCredit (10000 - (-1000) = 11000.00)", async () => {
		prisma.creditCard.findMany.mockResolvedValue([
			makeCard({ account: { id: "acct-1", balance: new Decimal(-1000) } }),
		]);
		const result = await service.findAllByProfile("p1");
		expect(result[0].availableCredit).toBe("11000.00");
	});

	it("rounds availableCredit to 2 decimal places (10000 - 3333.33 = 6666.67)", async () => {
		prisma.creditCard.findMany.mockResolvedValue([
			makeCard({ account: { id: "acct-1", balance: new Decimal("3333.33") } }),
		]);
		const result = await service.findAllByProfile("p1");
		expect(result[0].availableCredit).toBe("6666.67");
	});

	it("findOne returns availableCredit, currentBalance, and nextPaymentDueDate", async () => {
		const paymentDueDate = new Date("2026-11-04T00:00:00.000Z");
		prisma.creditCard.findFirst.mockResolvedValue(
			makeCard({ account: { id: "acct-1", balance: new Decimal(4000) } }),
		);
		prisma.cardStatement.findFirst.mockResolvedValue({ paymentDueDate });

		const result = await service.findOne("card-1", "p1");
		expect(result.availableCredit).toBe("6000.00");
		expect(result.currentBalance).toBe("4000.00");
		expect(result.nextPaymentDueDate).toBe(paymentDueDate);
	});

	it("findOne returns nextPaymentDueDate null when no unpaid statement exists", async () => {
		prisma.creditCard.findFirst.mockResolvedValue(
			makeCard({ account: { id: "acct-1", balance: new Decimal(2000) } }),
		);
		prisma.cardStatement.findFirst.mockResolvedValue(null);

		const result = await service.findOne("card-1", "p1");
		expect(result.availableCredit).toBe("8000.00");
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
		expect(result[0].availableCredit).toBe("8000.00");
		expect(result[1].availableCredit).toBe("0.00");
	});
});
