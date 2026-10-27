import { NotFoundException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { CreateRecurringByTypeDto, QueryRecurringByTypeDto } from "./dto/recurring-expense.dto";
import { RecurringExpensesService } from "./recurring-expenses.service";

describe("RecurringExpensesService (by-type endpoints)", () => {
	let service: RecurringExpensesService;
	let recurringExpense: Record<string, jest.Mock>;
	let account: Record<string, jest.Mock>;
	let category: Record<string, jest.Mock>;

	beforeEach(async () => {
		recurringExpense = {
			findMany: jest.fn().mockResolvedValue([]),
			count: jest.fn().mockResolvedValue(0),
			aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
			findFirst: jest.fn().mockResolvedValue(null),
			create: jest.fn().mockResolvedValue({}),
			update: jest.fn().mockResolvedValue({}),
			delete: jest.fn().mockResolvedValue({}),
		};
		account = {
			findFirst: jest.fn().mockResolvedValue({ id: "acc-1" }),
		};
		category = {
			findFirst: jest.fn().mockResolvedValue({ id: "cat-1" }),
		};
		const prisma = { recurringExpense, account, category } as unknown as PrismaService;
		const module: TestingModule = await Test.createTestingModule({
			providers: [RecurringExpensesService, { provide: PrismaService, useValue: prisma }],
		}).compile();
		service = module.get(RecurringExpensesService);
	});

	describe("findAllByType", () => {
		it("filters by type SERVICE in the where clause", async () => {
			await service.findAllByType("p1", "SERVICE");
			const call = recurringExpense.findMany.mock.calls[0][0];
			expect(call.where.type).toBe("SERVICE");
			expect(call.where.profileId).toBe("p1");
		});

		it("applies case-insensitive search on name", async () => {
			await service.findAllByType("p1", "SERVICE", { search: "netflix" });
			const call = recurringExpense.findMany.mock.calls[0][0];
			expect(call.where.name).toEqual({ contains: "netflix", mode: "insensitive" });
		});

		it("paginates with skip and take", async () => {
			await service.findAllByType("p1", "SERVICE", { page: 3, perPage: 5 });
			const call = recurringExpense.findMany.mock.calls[0][0];
			expect(call.skip).toBe(10);
			expect(call.take).toBe(5);
		});

		it("returns info with total (count) and totalEstimated (sum of amounts)", async () => {
			recurringExpense.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
			recurringExpense.count.mockResolvedValue(2);
			recurringExpense.aggregate.mockResolvedValue({ _sum: { amount: 199.5 } });
			const result = await service.findAllByType("p1", "SERVICE");
			expect(result.info.total).toBe(2);
			expect(result.info.totalEstimated).toBe(199.5);
			expect(result.total).toBe(2);
			expect(result.totalPages).toBe(1);
		});

		it("defaults isActive to true when not provided", async () => {
			await service.findAllByType("p1", "SERVICE");
			const call = recurringExpense.findMany.mock.calls[0][0];
			expect(call.where.isActive).toBe(true);
		});

		it("respects isActive false when explicitly provided", async () => {
			await service.findAllByType("p1", "SERVICE", { isActive: false });
			const call = recurringExpense.findMany.mock.calls[0][0];
			expect(call.where.isActive).toBe(false);
		});
	});

	describe("findOneByType", () => {
		it("throws NotFound when the item has wrong type", async () => {
			recurringExpense.findFirst.mockResolvedValue(null);
			await expect(service.findOneByType("id-1", "p1", "SERVICE")).rejects.toThrow(
				NotFoundException,
			);
		});

		it("returns the expense when found with correct type", async () => {
			const expense = { id: "id-1", type: "SERVICE", profileId: "p1" };
			recurringExpense.findFirst.mockResolvedValue(expense);
			const result = await service.findOneByType("id-1", "p1", "SERVICE");
			expect(result).toEqual(expense);
		});
	});

	describe("createByType", () => {
		it("forces the type to SERVICE even if dto does not have it", async () => {
			const dto = plainToInstance(CreateRecurringByTypeDto, {
				name: "Netflix",
				amount: 199,
				frequency: "MONTHLY",
				billingDays: [15],
				accountId: "acc-1",
			});
			recurringExpense.create.mockResolvedValue({ id: "new-1", type: "SERVICE" });
			await service.createByType("p1", "SERVICE", dto);
			const createCall = recurringExpense.create.mock.calls[0][0];
			expect(createCall.data.type).toBe("SERVICE");
		});
	});
});

describe("QueryRecurringByTypeDto validation", () => {
	it("rejects an invalid sortBy value", async () => {
		const instance = plainToInstance(QueryRecurringByTypeDto, { sortBy: "bogus" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "sortBy")).toBe(true);
	});

	it("rejects an invalid order value", async () => {
		const instance = plainToInstance(QueryRecurringByTypeDto, { order: "sideways" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "order")).toBe(true);
	});

	it("rejects perPage above 100", async () => {
		const instance = plainToInstance(QueryRecurringByTypeDto, { perPage: 101 });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "perPage")).toBe(true);
	});

	it("rejects page below 1", async () => {
		const instance = plainToInstance(QueryRecurringByTypeDto, { page: 0 });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "page")).toBe(true);
	});

	it("rejects a `type` field since it is not part of the DTO", async () => {
		const instance = plainToInstance(QueryRecurringByTypeDto, { type: "SERVICE" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "type")).toBe(true);
	});

	it("rejects an invalid isActive value", async () => {
		const instance = plainToInstance(QueryRecurringByTypeDto, { isActive: "maybe" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "isActive")).toBe(true);
	});
});
