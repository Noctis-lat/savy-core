import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CardStatementsService } from "./card-statements.service";
import { CreateCardStatementDto, QueryCardStatementsDto } from "./dto/card-statement.dto";

const Decimal = Prisma.Decimal;

describe("CardStatementsService (findAll filters)", () => {
	let service: CardStatementsService;
	let prisma: { cardStatement: { findMany: jest.Mock } };

	beforeEach(async () => {
		prisma = { cardStatement: { findMany: jest.fn().mockResolvedValue([]) } };
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				CardStatementsService,
				{ provide: PrismaService, useValue: prisma },
				{ provide: ConfigService, useValue: { get: jest.fn().mockReturnValue("false") } },
			],
		}).compile();
		service = module.get(CardStatementsService);
	});

	it("applies sortBy and order to orderBy", async () => {
		await service.findAllByProfile("p1", { sortBy: "periodEnd", order: "asc" });
		const call = prisma.cardStatement.findMany.mock.calls[0][0];
		expect(call.orderBy).toEqual({ periodEnd: "asc" });
	});

	it("passes creditCardId and isPaid filters through", async () => {
		await service.findAllByProfile("p1", { creditCardId: "card-1", isPaid: false });
		const call = prisma.cardStatement.findMany.mock.calls[0][0];
		expect(call.where.creditCardId).toBe("card-1");
		expect(call.where.isPaid).toBe(false);
	});
});

describe("CardStatementsService.create (feature flag guard)", () => {
	let service: CardStatementsService;
	let prisma: {
		creditCard: { findFirst: jest.Mock };
		cardStatement: { create: jest.Mock };
	};
	let configService: { get: jest.Mock };

	beforeEach(async () => {
		prisma = {
			creditCard: { findFirst: jest.fn().mockResolvedValue({ id: "card-1" }) },
			cardStatement: { create: jest.fn().mockResolvedValue({ id: "stmt-1" }) },
		};
		configService = { get: jest.fn() };
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				CardStatementsService,
				{ provide: PrismaService, useValue: prisma },
				{ provide: ConfigService, useValue: configService },
			],
		}).compile();
		service = module.get(CardStatementsService);
	});

	it("rejects caller-supplied balance when CREDIT_CARD_REACTIVE_ENABLED is true", async () => {
		configService.get.mockReturnValue("true");
		const dto = {
			creditCardId: "card-1",
			periodStart: "2026-09-15",
			periodEnd: "2026-10-15",
			balance: 5000,
			minPayment: 250,
			noInterestPayment: 5000,
			interestAmount: 100,
		} as unknown as CreateCardStatementDto;

		await expect(service.create("profile-1", dto)).rejects.toThrow(BadRequestException);
		expect(prisma.cardStatement.create).not.toHaveBeenCalled();
	});

	it("accepts caller-supplied fields when CREDIT_CARD_REACTIVE_ENABLED is false", async () => {
		configService.get.mockReturnValue("false");
		const dto = {
			creditCardId: "card-1",
			periodStart: "2026-09-15",
			periodEnd: "2026-10-15",
			balance: 5000,
			minPayment: 250,
			noInterestPayment: 5000,
			interestAmount: 100,
		} as unknown as CreateCardStatementDto;

		await service.create("profile-1", dto);
		expect(prisma.cardStatement.create).toHaveBeenCalled();
	});
});

describe("CardStatementsService.findTransactions", () => {
	let service: CardStatementsService;
	let prisma: {
		cardStatement: { findFirst: jest.Mock };
		transaction: { findMany: jest.Mock };
		installmentPlan: { findMany: jest.Mock };
	};

	beforeEach(async () => {
		prisma = {
			cardStatement: { findFirst: jest.fn() },
			transaction: { findMany: jest.fn() },
			installmentPlan: { findMany: jest.fn() },
		};
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				CardStatementsService,
				{ provide: PrismaService, useValue: prisma },
				{ provide: ConfigService, useValue: { get: jest.fn().mockReturnValue("true") } },
			],
		}).compile();
		service = module.get(CardStatementsService);
	});

	it("returns the transactions linked to the statement, oldest first, with installment null", async () => {
		const rows = [
			{ id: "tx-1", type: "EXPENSE" },
			{ id: "tx-2", type: "PAYMENT" },
		];
		prisma.cardStatement.findFirst.mockResolvedValue({ id: "stmt-1" });
		prisma.transaction.findMany.mockResolvedValue(rows);

		const result = await service.findTransactions("stmt-1", "profile-1");

		expect(result).toEqual([
			{ id: "tx-1", type: "EXPENSE", installment: null },
			{ id: "tx-2", type: "PAYMENT", installment: null },
		]);
		const call = prisma.transaction.findMany.mock.calls[0][0];
		expect(call.where).toEqual({ statementId: "stmt-1" });
		expect(call.orderBy).toEqual([{ date: "asc" }, { createdAt: "asc" }]);
		// No installment rows → no plan lookup
		expect(prisma.installmentPlan.findMany).not.toHaveBeenCalled();
	});

	it("lists INSTALLMENT rows first with their plan summary, loading plans in one batch", async () => {
		const cut = new Date(2026, 9, 15, 23, 59, 59, 999);
		prisma.cardStatement.findFirst.mockResolvedValue({ id: "stmt-2" });
		prisma.transaction.findMany.mockResolvedValue([
			{ id: "tx-buy", type: "EXPENSE", date: new Date(2026, 9, 1) },
			{ id: "tx-pay", type: "PAYMENT", date: new Date(2026, 9, 10) },
			{
				id: "tx-i-tv",
				type: "INSTALLMENT",
				date: cut,
				installmentPlanId: "plan-tv",
				installmentNumber: 5,
			},
			{
				id: "tx-i-laptop",
				type: "INSTALLMENT",
				date: cut,
				installmentPlanId: "plan-laptop",
				installmentNumber: 2,
			},
		]);
		prisma.installmentPlan.findMany.mockResolvedValue([
			{
				id: "plan-laptop",
				type: "MSI",
				status: "ACTIVE",
				totalMonths: 3,
				monthlyAmount: new Decimal(1000),
				transaction: {
					id: "tx-laptop",
					description: "Laptop",
					amount: new Decimal(3000),
					date: new Date(2026, 8, 5),
				},
				installments: [{ statement: { isPaid: true } }, { statement: { isPaid: false } }],
			},
			{
				id: "plan-tv",
				type: "MSCI",
				status: "PAID_OFF",
				totalMonths: 12,
				monthlyAmount: new Decimal(560),
				transaction: {
					id: "tx-tv",
					description: "TV",
					amount: new Decimal(6000),
					date: new Date(2026, 4, 5),
				},
				installments: Array.from({ length: 5 }, () => ({ statement: { isPaid: false } })),
			},
		]);

		const result = await service.findTransactions("stmt-2", "profile-1");

		expect(result.map((r) => r.id)).toEqual(["tx-i-laptop", "tx-i-tv", "tx-buy", "tx-pay"]);
		expect(prisma.installmentPlan.findMany).toHaveBeenCalledTimes(1);
		const planQuery = prisma.installmentPlan.findMany.mock.calls[0][0];
		expect(planQuery.where).toEqual({ id: { in: ["plan-tv", "plan-laptop"] } });

		expect(result[0].installment).toMatchObject({
			number: 2,
			totalInstallments: 3,
			billedInstallments: 2,
			paidInstallments: 1,
			remainingInstallments: 2,
			remainingAmount: "2000.00",
			purchase: { id: "tx-laptop", description: "Laptop", amount: "3000.00" },
		});
		expect(result[1].installment).toMatchObject({
			number: 5,
			type: "MSCI",
			status: "PAID_OFF",
			paidInstallments: 12,
			remainingInstallments: 0,
			principalAmount: "500.00",
			interestAmount: "60.00",
		});
		expect(result[2].installment).toBeNull();
		expect(result[3].installment).toBeNull();
	});

	it("scopes the statement lookup to the profile", async () => {
		prisma.cardStatement.findFirst.mockResolvedValue({ id: "stmt-1" });
		prisma.transaction.findMany.mockResolvedValue([]);

		await service.findTransactions("stmt-1", "profile-1");

		const call = prisma.cardStatement.findFirst.mock.calls[0][0];
		expect(call.where).toEqual({
			id: "stmt-1",
			creditCard: { account: { profileId: "profile-1" } },
		});
	});

	it("throws NotFound when the statement does not belong to the user", async () => {
		prisma.cardStatement.findFirst.mockResolvedValue(null);

		await expect(service.findTransactions("stmt-x", "profile-1")).rejects.toThrow(
			NotFoundException,
		);
		expect(prisma.transaction.findMany).not.toHaveBeenCalled();
	});
});

describe("QueryCardStatementsDto validation", () => {
	it("rejects an invalid sortBy value", async () => {
		const instance = plainToInstance(QueryCardStatementsDto, { sortBy: "bogus" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "sortBy")).toBe(true);
	});
});
