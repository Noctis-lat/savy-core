import { Test, type TestingModule } from "@nestjs/testing";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { BudgetsService } from "./budgets.service";
import { QueryBudgetsDto } from "./dto/budget.dto";

describe("BudgetsService (findAll filters)", () => {
	let service: BudgetsService;
	let prisma: {
		budget: { findMany: jest.Mock };
		account: { findMany: jest.Mock };
		transaction: { aggregate: jest.Mock };
	};

	beforeEach(async () => {
		prisma = {
			budget: { findMany: jest.fn().mockResolvedValue([]) },
			account: { findMany: jest.fn().mockResolvedValue([]) },
			transaction: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }) },
		};
		const module: TestingModule = await Test.createTestingModule({
			providers: [BudgetsService, { provide: PrismaService, useValue: prisma }],
		}).compile();
		service = module.get(BudgetsService);
	});

	it("applies sortBy and order to orderBy", async () => {
		await service.findAllByProfile("p1", { sortBy: "amount", order: "asc" });
		const call = prisma.budget.findMany.mock.calls[0][0];
		expect(call.orderBy).toEqual({ amount: "asc" });
	});

	it("defaults to startDate desc and isActive true", async () => {
		await service.findAllByProfile("p1", {});
		const call = prisma.budget.findMany.mock.calls[0][0];
		expect(call.orderBy).toEqual({ startDate: "desc" });
		expect(call.where.isActive).toBe(true);
	});

	it("passes a period filter through", async () => {
		await service.findAllByProfile("p1", { period: "MONTHLY" });
		const call = prisma.budget.findMany.mock.calls[0][0];
		expect(call.where.period).toBe("MONTHLY");
	});
});

describe("BudgetsService.getProgressForAll", () => {
	let service: BudgetsService;
	let prisma: {
		budget: { findMany: jest.Mock };
		account: { findMany: jest.Mock };
		transaction: { aggregate: jest.Mock };
	};

	beforeEach(async () => {
		prisma = {
			budget: { findMany: jest.fn() },
			account: { findMany: jest.fn().mockResolvedValue([{ id: "a-1" }]) },
			transaction: { aggregate: jest.fn() },
		};
		const module: TestingModule = await Test.createTestingModule({
			providers: [BudgetsService, { provide: PrismaService, useValue: prisma }],
		}).compile();
		service = module.get(BudgetsService);
	});

	it("returns an empty array when there are no active budgets", async () => {
		prisma.budget.findMany.mockResolvedValue([]);
		const result = await service.getProgressForAll("p1");
		expect(result).toEqual([]);
	});

	it("aggregates spent per budget and computes percentage", async () => {
		prisma.budget.findMany.mockResolvedValue([
			{
				id: "b-1",
				categoryId: "c-1",
				amount: { toString: () => "5000" } as unknown as object,
				startDate: new Date("2026-01-01T00:00:00.000Z"),
				period: "MONTHLY",
				isActive: true,
				category: { name: "Groceries" },
			},
		]);
		prisma.transaction.aggregate.mockResolvedValue({
			_sum: { amount: { toString: () => "3200" } as unknown as object },
		});

		const result = await service.getProgressForAll("p1");
		expect(result).toHaveLength(1);
		// Only EXPENSE counts as spending: INSTALLMENT rows (the same purchase billed
		// per cut) must never be summed again
		const aggArgs = prisma.transaction.aggregate.mock.calls[0][0];
		expect(aggArgs.where.type).toBe("EXPENSE");
		expect(result[0]).toMatchObject({
			id: "b-1",
			categoryName: "Groceries",
			spent: 3200,
			budget: 5000,
			remaining: 1800,
			percentage: 64,
		});
	});
});

describe("QueryBudgetsDto validation", () => {
	it("rejects an invalid sortBy value", async () => {
		const instance = plainToInstance(QueryBudgetsDto, { sortBy: "bogus" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "sortBy")).toBe(true);
	});

	it("rejects an invalid period value", async () => {
		const instance = plainToInstance(QueryBudgetsDto, { period: "DAILY" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "period")).toBe(true);
	});
});
