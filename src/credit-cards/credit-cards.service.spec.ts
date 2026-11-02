import { Test, type TestingModule } from "@nestjs/testing";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreditCalculationService } from "./calculations/credit-calculation.service";
import { CreditCardsService } from "./credit-cards.service";
import {
	CreateCreditCardDto,
	QueryCreditCardsDto,
	UpdateCreditCardDto,
} from "./dto/credit-card.dto";

const Decimal = Prisma.Decimal;

function makeCard(over: Record<string, unknown> = {}) {
	return {
		id: "card-1",
		accountId: "acct-1",
		creditLimit: new Decimal(10000),
		cutDay: 15,
		interestRate: new Decimal("0.36"),
		name: "Visa",
		color: null,
		icon: null,
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
			providers: [
				CreditCardsService,
				CreditCalculationService,
				{ provide: PrismaService, useValue: prisma },
			],
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

	it("applies search filter on credit card name (case-insensitive contains)", async () => {
		await service.findAllByProfile("p1", { search: "visa" });
		const call = prisma.creditCard.findMany.mock.calls[0][0];
		expect(call.where.name).toEqual({ contains: "visa", mode: "insensitive" });
		expect(call.where.account).toEqual({ profileId: "p1" });
	});

	it("omits name filter when search is not provided", async () => {
		await service.findAllByProfile("p1", {});
		const call = prisma.creditCard.findMany.mock.calls[0][0];
		expect(call.where).not.toHaveProperty("name");
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
		expect(call.where.name).toEqual({ contains: "visa", mode: "insensitive" });
		expect(call.where.account).toEqual({
			profileId: "p1",
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
			providers: [
				CreditCardsService,
				CreditCalculationService,
				{ provide: PrismaService, useValue: prisma },
			],
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

	it("computes currentCycleCutDate and currentCyclePaymentDueDate from cutDay and paymentDueDays", async () => {
		// makeCard has cutDay 15, paymentDueDays 20; faked time is Jan 1 2026 in create/update block
		// but this block uses real timers — so we mock the time
		jest.useFakeTimers().setSystemTime(new Date(2026, 0, 1, 12));
		prisma.creditCard.findMany.mockResolvedValue([
			makeCard({ account: { id: "acct-1", balance: new Decimal(3000) } }),
		]);
		const result = await service.findAllByProfile("p1");
		// cutDay 15, from Jan 1 → Jan 15
		expect(result.data[0].currentCycleCutDate).toEqual(new Date(2026, 0, 15));
		// Jan 15 + 20 days = Feb 4 (no weekend/holiday adjustment needed)
		expect(result.data[0].currentCyclePaymentDueDate).toEqual(new Date(2026, 1, 4));
		jest.useRealTimers();
	});

	it("does not include paymentDay in the response (legacy field stripped)", async () => {
		prisma.creditCard.findMany.mockResolvedValue([
			makeCard({ account: { id: "acct-1", balance: new Decimal(3000) } }),
		]);
		const result = await service.findAllByProfile("p1");
		expect(result.data[0]).not.toHaveProperty("paymentDay");
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
			providers: [
				CreditCardsService,
				CreditCalculationService,
				{ provide: PrismaService, useValue: prisma },
			],
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

// ─── create / update (entity-superior identity + paymentDueDays) ─────────

describe("CreditCardsService — create and update", () => {
	let service: CreditCardsService;
	let prisma: {
		account: { findFirst: jest.Mock; update: jest.Mock };
		creditCard: {
			findUnique: jest.Mock;
			findFirst: jest.Mock;
			create: jest.Mock;
			update: jest.Mock;
		};
		cardStatement: { findFirst: jest.Mock };
		$transaction: jest.Mock;
	};

	beforeEach(async () => {
		jest.useFakeTimers().setSystemTime(new Date(2026, 0, 1, 12));
		prisma = {
			account: {
				findFirst: jest.fn().mockResolvedValue({
					id: "acct-1",
					type: "CREDIT",
					name: "Visa Oro",
					color: "#1E40AF",
					icon: "credit-card",
				}),
				update: jest.fn().mockResolvedValue({}),
			},
			creditCard: {
				findUnique: jest.fn().mockResolvedValue(null),
				findFirst: jest.fn().mockResolvedValue(makeCard()),
				create: jest.fn((args: { data: unknown }) => Promise.resolve(args.data)),
				update: jest.fn((args: { data: unknown }) => Promise.resolve(args.data)),
			},
			cardStatement: { findFirst: jest.fn().mockResolvedValue(null) },
			$transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
		};
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				CreditCardsService,
				CreditCalculationService,
				{ provide: PrismaService, useValue: prisma },
			],
		}).compile();
		service = module.get(CreditCardsService);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("create inherits name/color/icon from the account and computes paymentDueDays", async () => {
		await service.create("p1", {
			accountId: "acct-1",
			creditLimit: 50000,
			cutDay: 5,
			paymentDay: 25,
			interestRate: 0.36,
		});
		expect(prisma.account.findFirst.mock.calls[0][0].select).toEqual(
			expect.objectContaining({ name: true, color: true, icon: true }),
		);
		const data = prisma.creditCard.create.mock.calls[0][0].data;
		expect(data).toEqual({
			accountId: "acct-1",
			name: "Visa Oro",
			color: "#1E40AF",
			icon: "credit-card",
			creditLimit: 50000,
			cutDay: 5,
			paymentDueDays: 20,
			interestRate: 0.36,
		});
		expect(data).not.toHaveProperty("paymentDay");
	});

	it("create DTO rejects removed fields and requires paymentDay", async () => {
		const dto = plainToInstance(CreateCreditCardDto, {
			accountId: "acct-1",
			creditLimit: 1000,
			cutDay: 5,
			interestRate: 0.36,
			paymentDueDays: 20,
			overLimitTolerance: 0,
			noInterestMonths: 3,
		});
		const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
		const props = errors.map((e) => e.property);
		expect(props).toEqual(
			expect.arrayContaining([
				"paymentDay",
				"paymentDueDays",
				"overLimitTolerance",
				"noInterestMonths",
			]),
		);
	});

	it("update DTO rejects removed fields", async () => {
		const dto = plainToInstance(UpdateCreditCardDto, {
			paymentDueDays: 20,
			overLimitTolerance: 0,
			noInterestMonths: 3,
		});
		const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.map((e) => e.property).sort()).toEqual([
			"noInterestMonths",
			"overLimitTolerance",
			"paymentDueDays",
		]);
	});

	it("update recomputes paymentDueDays from the existing cutDay when paymentDay is sent", async () => {
		// existing cutDay 15 → Jan 15 → Feb 5 = 21 days
		await service.update("card-1", "p1", { paymentDay: 5 });
		const data = prisma.creditCard.update.mock.calls[0][0].data;
		expect(data).toEqual({ paymentDueDays: 21 });
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});

	it("update recomputes paymentDueDays from the new cutDay when both are sent", async () => {
		await service.update("card-1", "p1", { cutDay: 5, paymentDay: 25 });
		const data = prisma.creditCard.update.mock.calls[0][0].data;
		expect(data).toEqual({ cutDay: 5, paymentDueDays: 20 });
	});

	it("update keeps paymentDueDays when only cutDay changes", async () => {
		await service.update("card-1", "p1", { cutDay: 10 });
		const data = prisma.creditCard.update.mock.calls[0][0].data;
		expect(data).toEqual({ cutDay: 10 });
	});

	it("update syncs name/color/icon to the account inside a transaction", async () => {
		await service.update("card-1", "p1", { name: "Visa Platino", color: "#000000" });
		expect(prisma.$transaction).toHaveBeenCalledTimes(1);
		expect(prisma.creditCard.update.mock.calls[0][0].data).toEqual({
			name: "Visa Platino",
			color: "#000000",
		});
		expect(prisma.account.update).toHaveBeenCalledWith({
			where: { id: "acct-1" },
			data: { name: "Visa Platino", color: "#000000" },
		});
	});

	it("update does not touch the account when identity fields are absent", async () => {
		await service.update("card-1", "p1", { creditLimit: 20000 });
		expect(prisma.$transaction).not.toHaveBeenCalled();
		expect(prisma.account.update).not.toHaveBeenCalled();
	});
});
