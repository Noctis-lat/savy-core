import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { CardStatementsService } from "./card-statements.service";
import { CreateCardStatementDto, QueryCardStatementsDto } from "./dto/card-statement.dto";

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

describe("QueryCardStatementsDto validation", () => {
	it("rejects an invalid sortBy value", async () => {
		const instance = plainToInstance(QueryCardStatementsDto, { sortBy: "bogus" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "sortBy")).toBe(true);
	});
});
