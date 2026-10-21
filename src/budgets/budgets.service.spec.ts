import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { BudgetsService } from "./budgets.service";
import { CreateBudgetDto, QueryBudgetsDto, UpdateBudgetDto } from "./dto/budget.dto";

function decimal(value: string): Prisma.Decimal {
	return new Prisma.Decimal(value);
}

type MockModel = Record<string, jest.Mock>;

interface MockPrisma {
	budget: MockModel;
	budgetItem: MockModel;
	category: MockModel;
	transaction: MockModel;
	budgetPeriodSnapshot: MockModel;
	$transaction: jest.Mock;
}

describe("BudgetsService", () => {
	let service: BudgetsService;
	let prisma: MockPrisma;

	beforeEach(async () => {
		prisma = {
			budget: {
				findMany: jest.fn().mockResolvedValue([]),
				count: jest.fn().mockResolvedValue(0),
				findFirst: jest.fn(),
				create: jest.fn(),
				update: jest.fn(),
			},
			budgetItem: {
				deleteMany: jest.fn(),
				aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
			},
			category: {
				findMany: jest.fn(),
			},
			transaction: {
				aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
				findMany: jest.fn().mockResolvedValue([]),
				count: jest.fn().mockResolvedValue(0),
			},
			budgetPeriodSnapshot: {
				findUnique: jest.fn().mockResolvedValue(null),
				findMany: jest.fn().mockResolvedValue([]),
				create: jest.fn(),
			},
			$transaction: jest.fn((fn: (tx: MockPrisma) => unknown) => fn(prisma)),
		};
		const module: TestingModule = await Test.createTestingModule({
			providers: [BudgetsService, { provide: PrismaService, useValue: prisma }],
		}).compile();
		service = module.get(BudgetsService);
	});

	// ─── findAllByProfile ──────────────────────────────────────────────

	describe("findAllByProfile", () => {
		it("defaults to startDate desc and isActive true", async () => {
			await service.findAllByProfile("p1", {});
			const call = prisma.budget.findMany.mock.calls[0][0];
			expect(call.orderBy).toEqual({ startDate: "desc" });
			expect(call.where.isActive).toBe(true);
		});

		it("passes kind filter through", async () => {
			await service.findAllByProfile("p1", { kind: "ONE_TIME" });
			const call = prisma.budget.findMany.mock.calls[0][0];
			expect(call.where.kind).toBe("ONE_TIME");
		});

		it("passes period filter through", async () => {
			await service.findAllByProfile("p1", { period: "MONTHLY" });
			const call = prisma.budget.findMany.mock.calls[0][0];
			expect(call.where.period).toBe("MONTHLY");
		});

		it("supports sortBy name", async () => {
			await service.findAllByProfile("p1", { sortBy: "name", order: "asc" });
			const call = prisma.budget.findMany.mock.calls[0][0];
			expect(call.orderBy).toEqual({ name: "asc" });
		});

		it("includes items with category name and type", async () => {
			await service.findAllByProfile("p1", {});
			const call = prisma.budget.findMany.mock.calls[0][0];
			expect(call.include.items.include.category.select).toEqual({
				id: true,
				name: true,
				type: true,
			});
		});
	});

	// ─── findOne ───────────────────────────────────────────────────────

	describe("findOne", () => {
		it("throws NotFoundException when budget does not exist", async () => {
			prisma.budget.findFirst.mockResolvedValue(null);
			await expect(service.findOne("b1", "p1")).rejects.toThrow(NotFoundException);
		});

		it("returns the budget when found", async () => {
			const budget = { id: "b1", name: "Test", items: [] };
			prisma.budget.findFirst.mockResolvedValue(budget);
			const result = await service.findOne("b1", "p1");
			expect(result).toEqual(budget);
		});
	});

	// ─── create ────────────────────────────────────────────────────────

	describe("create", () => {
		const validDto: CreateBudgetDto = plainToInstance(CreateBudgetDto, {
			name: "Groceries Budget",
			kind: "RECURRING",
			period: "MONTHLY",
			startDate: "2026-01-01",
			items: [{ categoryId: "c1", amount: 5000 }],
		});

		it("creates a budget with nested items", async () => {
			prisma.category.findMany.mockResolvedValue([{ id: "c1", type: "EXPENSE" }]);
			prisma.budget.create.mockResolvedValue({ id: "b1", items: [] });

			await service.create("p1", validDto);

			const call = prisma.budget.create.mock.calls[0][0];
			expect(call.data.profileId).toBe("p1");
			expect(call.data.name).toBe("Groceries Budget");
			expect(call.data.kind).toBe("RECURRING");
			expect(call.data.items.create).toEqual([{ categoryId: "c1", amount: 5000 }]);
		});

		it("persists color and icon when provided, null otherwise", async () => {
			prisma.category.findMany.mockResolvedValue([{ id: "c1", type: "EXPENSE" }]);
			prisma.budget.create.mockResolvedValue({ id: "b1", items: [] });

			await service.create(
				"p1",
				plainToInstance(CreateBudgetDto, { ...validDto, color: "#0d9488", icon: "wallet" }),
			);
			await service.create("p1", validDto);

			const withStyle = prisma.budget.create.mock.calls[0][0];
			expect(withStyle.data.color).toBe("#0d9488");
			expect(withStyle.data.icon).toBe("wallet");
			const withoutStyle = prisma.budget.create.mock.calls[1][0];
			expect(withoutStyle.data.color).toBeNull();
			expect(withoutStyle.data.icon).toBeNull();
		});

		it("throws BadRequestException when RECURRING has no period", async () => {
			const dto = plainToInstance(CreateBudgetDto, {
				name: "Bad",
				kind: "RECURRING",
				startDate: "2026-01-01",
				items: [{ categoryId: "c1", amount: 100 }],
			});
			await expect(service.create("p1", dto)).rejects.toThrow(BadRequestException);
		});

		it("throws BadRequestException when ONE_TIME has a period", async () => {
			const dto = plainToInstance(CreateBudgetDto, {
				name: "Bad",
				kind: "ONE_TIME",
				period: "MONTHLY",
				startDate: "2026-01-01",
				endDate: "2026-12-31",
				items: [{ categoryId: "c1", amount: 100 }],
			});
			await expect(service.create("p1", dto)).rejects.toThrow(BadRequestException);
		});

		it("throws BadRequestException when ONE_TIME has no endDate", async () => {
			const dto = plainToInstance(CreateBudgetDto, {
				name: "Bad",
				kind: "ONE_TIME",
				startDate: "2026-01-01",
				items: [{ categoryId: "c1", amount: 100 }],
			});
			await expect(service.create("p1", dto)).rejects.toThrow(BadRequestException);
		});

		it("throws NotFoundException when category does not belong to user", async () => {
			prisma.category.findMany.mockResolvedValue([]);

			await expect(service.create("p1", validDto)).rejects.toThrow(NotFoundException);
		});

		it("throws BadRequestException when ONE_TIME endDate is not after startDate", async () => {
			const dto = plainToInstance(CreateBudgetDto, {
				name: "Bad",
				kind: "ONE_TIME",
				startDate: "2026-06-01",
				endDate: "2026-06-01",
				items: [{ categoryId: "c1", amount: 100 }],
			});
			await expect(service.create("p1", dto)).rejects.toThrow(BadRequestException);
		});

		it("throws BadRequestException on duplicate categoryId", async () => {
			const dto = plainToInstance(CreateBudgetDto, {
				name: "Dup",
				kind: "RECURRING",
				period: "MONTHLY",
				startDate: "2026-01-01",
				items: [
					{ categoryId: "c1", amount: 100 },
					{ categoryId: "c1", amount: 200 },
				],
			});
			await expect(service.create("p1", dto)).rejects.toThrow(BadRequestException);
			expect(prisma.category.findMany).not.toHaveBeenCalled();
		});

		it("scopes category lookup to the profile", async () => {
			prisma.category.findMany.mockResolvedValue([{ id: "c1" }]);
			prisma.budget.create.mockResolvedValue({ id: "b1", items: [] });

			await service.create("p1", validDto);

			expect(prisma.category.findMany.mock.calls[0][0].where).toEqual({
				id: { in: ["c1"] },
				profileId: "p1",
			});
		});

		it("allows INCOME categories", async () => {
			prisma.category.findMany.mockResolvedValue([{ id: "c1", type: "INCOME" }]);
			prisma.budget.create.mockResolvedValue({ id: "b1", items: [] });

			const dto = plainToInstance(CreateBudgetDto, {
				name: "Income Budget",
				kind: "RECURRING",
				period: "MONTHLY",
				startDate: "2026-01-01",
				items: [{ categoryId: "c1", amount: 10000 }],
			});

			await service.create("p1", dto);
			expect(prisma.budget.create).toHaveBeenCalled();
		});
	});

	// ─── update ────────────────────────────────────────────────────────

	describe("update", () => {
		it("updates scalar fields without touching items", async () => {
			prisma.budget.findFirst.mockResolvedValue({
				id: "b1",
				name: "Old",
				kind: "RECURRING",
				period: "MONTHLY",
				startDate: new Date("2026-01-01"),
				endDate: null,
				isActive: true,
				items: [],
			});
			prisma.budget.update.mockResolvedValue({ id: "b1", items: [] });

			await service.update("b1", "p1", { name: "New Name" } as never);

			const call = prisma.budget.update.mock.calls[0][0];
			expect(call.data.name).toBe("New Name");
			expect(call.data.items).toBeUndefined();
		});

		it("updates color and icon, clears them with null, and leaves them untouched when omitted", async () => {
			prisma.budget.findFirst.mockResolvedValue({
				id: "b1",
				kind: "RECURRING",
				period: "MONTHLY",
				startDate: new Date("2026-01-01"),
				endDate: null,
				color: "#0d9488",
				icon: "wallet",
				items: [],
			});
			prisma.budget.update.mockResolvedValue({ id: "b1", items: [] });

			await service.update("b1", "p1", { color: "#f59e0b", icon: "plane" } as UpdateBudgetDto);
			await service.update("b1", "p1", { color: null, icon: null } as UpdateBudgetDto);
			await service.update("b1", "p1", { name: "Other" } as UpdateBudgetDto);

			const [set, cleared, untouched] = prisma.budget.update.mock.calls.map((c) => c[0]);
			expect(set.data).toMatchObject({ color: "#f59e0b", icon: "plane" });
			expect(cleared.data.color).toBeNull();
			expect(cleared.data.icon).toBeNull();
			expect("color" in untouched.data).toBe(false);
			expect("icon" in untouched.data).toBe(false);
		});

		it("replaces items when dto.items is provided", async () => {
			prisma.budget.findFirst.mockResolvedValue({
				id: "b1",
				name: "Old",
				kind: "RECURRING",
				period: "MONTHLY",
				startDate: new Date("2026-01-01"),
				endDate: null,
				isActive: true,
				items: [{ id: "old-item", categoryId: "c-old" }],
			});
			prisma.category.findMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
			prisma.budget.update.mockResolvedValue({ id: "b1", items: [] });

			await service.update("b1", "p1", {
				items: [
					{ categoryId: "c1", amount: 1000 },
					{ categoryId: "c2", amount: 2000 },
				],
			} as never);

			expect(prisma.$transaction).toHaveBeenCalled();
			expect(prisma.budgetItem.deleteMany).toHaveBeenCalledWith({ where: { budgetId: "b1" } });
			const updateCall = prisma.budget.update.mock.calls[0][0];
			expect(updateCall.data.items.create).toEqual([
				{ categoryId: "c1", amount: 1000 },
				{ categoryId: "c2", amount: 2000 },
			]);
		});

		it("re-validates against merged values when switching to ONE_TIME", async () => {
			prisma.budget.findFirst.mockResolvedValue({
				id: "b1",
				kind: "RECURRING",
				period: "MONTHLY",
				startDate: new Date("2026-01-01"),
				endDate: null,
				items: [],
			});

			// period still MONTHLY from existing → invalid
			await expect(
				service.update("b1", "p1", { kind: "ONE_TIME", endDate: "2026-12-31" } as UpdateBudgetDto),
			).rejects.toThrow(BadRequestException);

			// clearing period makes it valid
			prisma.budget.update.mockResolvedValue({ id: "b1", items: [] });
			await service.update("b1", "p1", {
				kind: "ONE_TIME",
				period: null,
				endDate: "2026-12-31",
			} as UpdateBudgetDto);
			const call = prisma.budget.update.mock.calls[0][0];
			expect(call.data.period).toBeNull();
			expect(call.data.endDate).toEqual(new Date("2026-12-31"));
		});

		it("clears endDate when null is passed", async () => {
			prisma.budget.findFirst.mockResolvedValue({
				id: "b1",
				kind: "RECURRING",
				period: "MONTHLY",
				startDate: new Date("2026-01-01"),
				endDate: new Date("2026-12-31"),
				items: [],
			});
			prisma.budget.update.mockResolvedValue({ id: "b1", items: [] });

			await service.update("b1", "p1", { endDate: null } as UpdateBudgetDto);

			expect(prisma.budget.update.mock.calls[0][0].data.endDate).toBeNull();
		});

		it("rejects duplicate categoryId in replacement items", async () => {
			prisma.budget.findFirst.mockResolvedValue({
				id: "b1",
				kind: "RECURRING",
				period: "MONTHLY",
				startDate: new Date("2026-01-01"),
				endDate: null,
				items: [],
			});

			await expect(
				service.update("b1", "p1", {
					items: [
						{ categoryId: "c1", amount: 1 },
						{ categoryId: "c1", amount: 2 },
					],
				} as UpdateBudgetDto),
			).rejects.toThrow(BadRequestException);
			expect(prisma.budgetItem.deleteMany).not.toHaveBeenCalled();
		});
	});

	// ─── remove ────────────────────────────────────────────────────────

	describe("remove", () => {
		it("soft-deletes by setting isActive false", async () => {
			prisma.budget.findFirst.mockResolvedValue({ id: "b1", items: [] });
			await service.remove("b1", "p1");
			expect(prisma.budget.update).toHaveBeenCalledWith({
				where: { id: "b1" },
				data: { isActive: false },
			});
		});
	});

	// ─── getProgress ───────────────────────────────────────────────────

	function expenseItem(overrides: Record<string, unknown> = {}) {
		return {
			id: "item-1",
			budgetId: "b1",
			categoryId: "c-exp",
			amount: decimal("5000"),
			createdAt: new Date(),
			updatedAt: new Date(),
			category: { id: "c-exp", name: "Groceries", type: "EXPENSE" },
			...overrides,
		};
	}

	function mockBudget(overrides: Record<string, unknown> = {}) {
		return {
			id: "b1",
			name: "Test Budget",
			color: "#0d9488",
			icon: "wallet",
			kind: "RECURRING" as const,
			period: "MONTHLY" as const,
			startDate: new Date("2026-01-01T00:00:00.000Z"),
			endDate: null,
			isActive: true,
			profileId: "p1",
			createdAt: new Date(),
			updatedAt: new Date(),
			items: [expenseItem()],
			...overrides,
		};
	}

	describe("getProgress", () => {
		beforeEach(() => {
			// Previous-period snapshot already exists → no snapshot aggregates consumed
			prisma.budgetPeriodSnapshot.findUnique.mockResolvedValue({ id: "existing" });
		});

		it("computes EXPENSE item spent correctly with the shared progress shape", async () => {
			prisma.budget.findFirst.mockResolvedValue(mockBudget());
			prisma.transaction.aggregate
				.mockResolvedValueOnce({ _sum: { amount: decimal("3200") } })
				.mockResolvedValueOnce({ _sum: { amount: null } });

			const result = await service.getProgress("b1", "p1");

			expect(result.id).toBe("b1");
			expect(result.name).toBe("Test Budget");
			expect(result.color).toBe("#0d9488");
			expect(result.icon).toBe("wallet");
			expect(result.items).toHaveLength(1);
			expect(result.items[0]).toEqual({
				categoryId: "c-exp",
				categoryName: "Groceries",
				categoryType: "EXPENSE",
				plannedAmount: 5000,
				spentAmount: 3200,
				remaining: 1800,
				percentage: 64,
			});
			expect(result.totalSpent).toBe(3200);
			expect(result.totalPlanned).toBe(5000);
			expect(result.totalRemaining).toBe(1800);
			expect(result.totalPercentage).toBe(64);
		});

		it("uses exact decimal arithmetic for sums", async () => {
			prisma.budget.findFirst.mockResolvedValue(
				mockBudget({ items: [expenseItem({ amount: decimal("0.30") })] }),
			);
			prisma.transaction.aggregate
				.mockResolvedValueOnce({ _sum: { amount: decimal("0.10") } })
				.mockResolvedValueOnce({ _sum: { amount: decimal("0.20") } });

			const result = await service.getProgress("b1", "p1");

			expect(result.items[0].spentAmount).toBe(0.3);
			expect(result.items[0].remaining).toBe(0);
			expect(result.items[0].percentage).toBe(100);
		});

		it("computes INCOME item from INCOME transactions only", async () => {
			prisma.budget.findFirst.mockResolvedValue(
				mockBudget({
					items: [
						expenseItem({
							id: "item-inc",
							categoryId: "c-inc",
							amount: decimal("10000"),
							category: { id: "c-inc", name: "Salary", type: "INCOME" },
						}),
					],
				}),
			);
			prisma.transaction.aggregate.mockResolvedValueOnce({ _sum: { amount: decimal("8000") } });

			const result = await service.getProgress("b1", "p1");

			expect(prisma.transaction.aggregate).toHaveBeenCalledTimes(1);
			const call = prisma.transaction.aggregate.mock.calls[0][0];
			expect(call.where.type).toBe("INCOME");
			expect(call.where.categoryId).toBe("c-inc");
			expect(call.where.account).toEqual({ profileId: "p1" });
			expect(result.items[0].spentAmount).toBe(8000);
			expect(result.items[0].percentage).toBe(80);
		});

		it("excludes installment-plan purchases from the EXPENSE sum and scopes by profile", async () => {
			prisma.budget.findFirst.mockResolvedValue(mockBudget());
			prisma.transaction.aggregate
				.mockResolvedValueOnce({ _sum: { amount: decimal("1000") } })
				.mockResolvedValueOnce({ _sum: { amount: null } });

			const result = await service.getProgress("b1", "p1");

			const expenseCall = prisma.transaction.aggregate.mock.calls[0][0];
			expect(expenseCall.where.type).toBe("EXPENSE");
			expect(expenseCall.where.categoryId).toBe("c-exp");
			expect(expenseCall.where.installmentPlan).toBeNull();
			expect(expenseCall.where.account).toEqual({ profileId: "p1" });
			expect(expenseCall.where.date.gte).toEqual(result.periodStart);
			expect(expenseCall.where.date.lte).toEqual(result.periodEnd);
			expect(result.items[0].spentAmount).toBe(1000);
		});

		it("adds INSTALLMENT rows resolved via billedPlan.transaction.categoryId", async () => {
			prisma.budget.findFirst.mockResolvedValue(mockBudget());
			prisma.transaction.aggregate
				.mockResolvedValueOnce({ _sum: { amount: decimal("1000") } })
				.mockResolvedValueOnce({ _sum: { amount: decimal("500") } });

			const result = await service.getProgress("b1", "p1");

			const installmentCall = prisma.transaction.aggregate.mock.calls[1][0];
			expect(installmentCall.where.type).toBe("INSTALLMENT");
			expect(installmentCall.where.billedPlan).toEqual({
				transaction: { categoryId: "c-exp" },
			});
			expect(installmentCall.where.account).toEqual({ profileId: "p1" });
			expect(result.items[0].spentAmount).toBe(1500);
		});

		it("computes ONE_TIME budget using the full date range", async () => {
			prisma.budget.findFirst.mockResolvedValue(
				mockBudget({
					kind: "ONE_TIME" as const,
					period: null,
					startDate: new Date("2026-01-01T00:00:00.000Z"),
					endDate: new Date("2026-12-31T23:59:59.999Z"),
				}),
			);
			prisma.transaction.aggregate
				.mockResolvedValueOnce({ _sum: { amount: decimal("2000") } })
				.mockResolvedValueOnce({ _sum: { amount: null } });

			const result = await service.getProgress("b1", "p1");

			expect(result.periodStart).toEqual(new Date("2026-01-01T00:00:00.000Z"));
			expect(result.periodEnd).toEqual(new Date("2026-12-31T23:59:59.999Z"));
			expect(result.items[0].spentAmount).toBe(2000);
			expect(prisma.budgetPeriodSnapshot.create).not.toHaveBeenCalled();
		});

		it("returns the last period (clamped to endDate) when a RECURRING budget has ended", async () => {
			const endDate = new Date("2025-03-10T00:00:00.000Z");
			prisma.budget.findFirst.mockResolvedValue(
				mockBudget({ startDate: new Date("2025-01-01T00:00:00.000Z"), endDate }),
			);

			const result = await service.getProgress("b1", "p1");

			expect(result.periodStart.getTime()).toBeLessThanOrEqual(endDate.getTime());
			expect(result.periodEnd).toEqual(endDate);
		});
	});

	// ─── Snapshots ─────────────────────────────────────────────────────

	describe("lazy snapshots", () => {
		it("creates a snapshot for the ended previous period with per-item amounts", async () => {
			prisma.budget.findFirst.mockResolvedValue(mockBudget());
			prisma.budgetPeriodSnapshot.findUnique.mockResolvedValue(null);
			// Snapshot aggregates first (expense, installment), then current period
			prisma.transaction.aggregate
				.mockResolvedValueOnce({ _sum: { amount: decimal("4000") } })
				.mockResolvedValueOnce({ _sum: { amount: decimal("250.50") } });

			const now = new Date();
			await service.getProgress("b1", "p1");

			expect(prisma.budgetPeriodSnapshot.create).toHaveBeenCalledTimes(1);
			const { data } = prisma.budgetPeriodSnapshot.create.mock.calls[0][0];
			expect(data.budgetId).toBe("b1");
			expect(data.periodStart.getTime()).toBeGreaterThanOrEqual(
				new Date("2026-01-01T00:00:00.000Z").getTime(),
			);
			expect(data.periodEnd.getTime()).toBeLessThan(now.getTime());
			expect(data.totalPlanned.toString()).toBe("5000");
			expect(data.totalSpent.toString()).toBe("4250.5");
			expect(data.items.createMany.data).toHaveLength(1);
			expect(data.items.createMany.data[0].budgetItemId).toBe("item-1");
			expect(data.items.createMany.data[0].categoryId).toBe("c-exp");
			expect(data.items.createMany.data[0].spentAmount.toString()).toBe("4250.5");
		});

		it("skips creation when the snapshot already exists", async () => {
			prisma.budget.findFirst.mockResolvedValue(mockBudget());
			prisma.budgetPeriodSnapshot.findUnique.mockResolvedValue({ id: "existing" });

			await service.getProgress("b1", "p1");

			expect(prisma.budgetPeriodSnapshot.create).not.toHaveBeenCalled();
		});

		it("does not snapshot when the current period is the first one", async () => {
			prisma.budget.findFirst.mockResolvedValue(
				mockBudget({ startDate: new Date(Date.now() - 24 * 60 * 60 * 1000) }),
			);

			await service.getProgress("b1", "p1");

			expect(prisma.budgetPeriodSnapshot.findUnique).not.toHaveBeenCalled();
			expect(prisma.budgetPeriodSnapshot.create).not.toHaveBeenCalled();
		});

		it("swallows unique violations from concurrent reads (P2002)", async () => {
			prisma.budget.findFirst.mockResolvedValue(mockBudget());
			prisma.budgetPeriodSnapshot.create.mockRejectedValue(
				Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
			);

			await expect(service.getProgress("b1", "p1")).resolves.toBeDefined();
		});

		it("rethrows other snapshot errors", async () => {
			prisma.budget.findFirst.mockResolvedValue(mockBudget());
			prisma.budgetPeriodSnapshot.create.mockRejectedValue(new Error("boom"));

			await expect(service.getProgress("b1", "p1")).rejects.toThrow("boom");
		});
	});

	// ─── getProgressForAll ─────────────────────────────────────────────

	describe("getProgressForAll", () => {
		beforeEach(() => {
			prisma.budgetPeriodSnapshot.findUnique.mockResolvedValue({ id: "existing" });
		});

		it("returns empty array when no active budgets", async () => {
			prisma.budget.findMany.mockResolvedValue([]);
			const result = await service.getProgressForAll("p1");
			expect(result).toEqual([]);
			expect(prisma.budget.findMany.mock.calls[0][0].where).toEqual({
				profileId: "p1",
				isActive: true,
			});
		});

		it("returns progress for all active budgets", async () => {
			prisma.budget.findMany.mockResolvedValue([
				mockBudget({
					name: "Budget 1",
					items: [
						expenseItem({
							id: "i1",
							categoryId: "c1",
							amount: decimal("3000"),
							category: { id: "c1", name: "Food", type: "EXPENSE" },
						}),
					],
				}),
			]);
			prisma.transaction.aggregate
				.mockResolvedValueOnce({ _sum: { amount: decimal("1500") } })
				.mockResolvedValueOnce({ _sum: { amount: null } });

			const result = await service.getProgressForAll("p1");

			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("b1");
			expect(result[0].name).toBe("Budget 1");
			expect(result[0].kind).toBe("RECURRING");
			expect(result[0].period).toBe("MONTHLY");
			expect(result[0].totalPlanned).toBe(3000);
			expect(result[0].totalSpent).toBe(1500);
			expect(result[0].totalRemaining).toBe(1500);
			expect(result[0].totalPercentage).toBe(50);
			expect(result[0].items).toHaveLength(1);
			expect(result[0].items[0].categoryName).toBe("Food");
		});
	});

	// ─── findAllByProfile: pagination + info ───────────────────────────

	describe("findAllByProfile pagination and info", () => {
		function incomeItem(overrides: Record<string, unknown> = {}) {
			return expenseItem({
				id: "item-inc",
				categoryId: "c-inc",
				category: { id: "c-inc", name: "Salary", type: "INCOME" },
				...overrides,
			});
		}

		it("applies skip/take from page and perPage", async () => {
			await service.findAllByProfile("p1", { page: 3, perPage: 5 });
			const call = prisma.budget.findMany.mock.calls[0][0];
			expect(call.skip).toBe(10);
			expect(call.take).toBe(5);
		});

		it("filters by name with case-insensitive search across list, count and info", async () => {
			await service.findAllByProfile("p1", { search: "base" });
			const nameFilter = { contains: "base", mode: "insensitive" };
			expect(prisma.budget.findMany.mock.calls[0][0].where.name).toEqual(nameFilter);
			expect(prisma.budget.count.mock.calls[0][0].where.name).toEqual(nameFilter);
			for (const [args] of prisma.budgetItem.aggregate.mock.calls) {
				expect(args.where.budget.name).toEqual(nameFilter);
			}
		});

		it("does not filter by name when search is empty", async () => {
			await service.findAllByProfile("p1", { search: "" });
			expect(prisma.budget.findMany.mock.calls[0][0].where.name).toBeUndefined();
		});

		it("defaults to page 1 and perPage 10", async () => {
			const result = await service.findAllByProfile("p1", {});
			const call = prisma.budget.findMany.mock.calls[0][0];
			expect(call.skip).toBe(0);
			expect(call.take).toBe(10);
			expect(result.page).toBe(1);
			expect(result.perPage).toBe(10);
		});

		it("returns totalPages 1 and zero info when there are no budgets", async () => {
			prisma.budget.count.mockResolvedValue(0);
			const result = await service.findAllByProfile("p1", {});
			expect(result).toEqual({
				budgets: [],
				info: { totalExpenses: 0, totalIncomes: 0 },
				page: 1,
				perPage: 10,
				total: 0,
				totalPages: 1,
			});
		});

		it("computes totalPages from total and perPage, counting with the same filters", async () => {
			prisma.budget.count.mockResolvedValue(21);
			const result = await service.findAllByProfile("p1", { perPage: 10, kind: "RECURRING" });
			expect(result.total).toBe(21);
			expect(result.totalPages).toBe(3);
			expect(prisma.budget.count.mock.calls[0][0].where).toEqual({
				profileId: "p1",
				isActive: true,
				kind: "RECURRING",
			});
		});

		it("sums planned EXPENSE vs INCOME item amounts across all filtered budgets", async () => {
			prisma.budgetItem.aggregate.mockImplementation(
				(args: { where: { category: { type: string } } }) =>
					Promise.resolve({
						_sum: {
							amount: decimal(args.where.category.type === "EXPENSE" ? "1500.555" : "20000"),
						},
					}),
			);

			const result = await service.findAllByProfile("p1", { perPage: 1, kind: "RECURRING" });

			expect(result.info).toEqual({ totalExpenses: 1500.56, totalIncomes: 20000 });
			expect(prisma.budgetItem.aggregate).toHaveBeenCalledTimes(2);
			const calls = prisma.budgetItem.aggregate.mock.calls.map((c) => c[0]);
			const filteredWhere = { profileId: "p1", isActive: true, kind: "RECURRING" };
			expect(calls.map((c) => c.where)).toEqual(
				expect.arrayContaining([
					{ budget: filteredWhere, category: { type: "EXPENSE" } },
					{ budget: filteredWhere, category: { type: "INCOME" } },
				]),
			);
			// Aggregate is not paginated → covers every filtered budget, not just the page
			for (const call of calls) {
				expect(call.skip).toBeUndefined();
				expect(call.take).toBeUndefined();
			}
			// Info never queries transactions
			expect(prisma.transaction.aggregate).not.toHaveBeenCalled();
			// Only the paginated page query loads budgets
			expect(prisma.budget.findMany).toHaveBeenCalledTimes(1);
		});

		it("returns zero info when no budget items match", async () => {
			const result = await service.findAllByProfile("p1", {});
			expect(result.info).toEqual({ totalExpenses: 0, totalIncomes: 0 });
		});

		it("adds per-budget totalExpenses ignoring INCOME items", async () => {
			prisma.budget.findMany.mockResolvedValue([
				mockBudget({
					items: [
						expenseItem({ amount: decimal("600") }),
						expenseItem({
							id: "item-2",
							categoryId: "c-exp2",
							amount: decimal("400"),
							category: { id: "c-exp2", name: "Fuel", type: "EXPENSE" },
						}),
						incomeItem({ amount: decimal("9000") }),
					],
				}),
			]);
			prisma.budget.count.mockResolvedValue(1);

			const result = await service.findAllByProfile("p1", {});

			expect(result.budgets[0].totalExpenses).toBe(1000);
			expect(result.budgets[0].items).toHaveLength(3);
		});

		it("computes periodExpenses from EXPENSE items only, including installments", async () => {
			prisma.budget.findMany.mockResolvedValue([
				mockBudget({ items: [expenseItem({ amount: decimal("1000") }), incomeItem()] }),
			]);
			prisma.budget.count.mockResolvedValue(1);
			prisma.transaction.aggregate.mockImplementation((args: { where: { type: string } }) => {
				const amounts: Record<string, string> = {
					EXPENSE: "500.10",
					INSTALLMENT: "299.90",
					INCOME: "9999",
				};
				return Promise.resolve({ _sum: { amount: decimal(amounts[args.where.type]) } });
			});

			const result = await service.findAllByProfile("p1", {});

			const types = prisma.transaction.aggregate.mock.calls.map((c) => c[0].where.type);
			expect(types.sort()).toEqual(["EXPENSE", "INSTALLMENT"]);
			const installmentCall = prisma.transaction.aggregate.mock.calls.find(
				(c) => c[0].where.type === "INSTALLMENT",
			)?.[0];
			expect(installmentCall.where.billedPlan).toEqual({ transaction: { categoryId: "c-exp" } });
			expect(installmentCall.where.account).toEqual({ profileId: "p1" });
			expect(result.budgets[0].periodExpenses).toBe(800);
			expect(result.budgets[0].percentage).toBe(80);
		});

		it("allows percentage above 100", async () => {
			prisma.budget.findMany.mockResolvedValue([
				mockBudget({ items: [expenseItem({ amount: decimal("1000") })] }),
			]);
			prisma.transaction.aggregate
				.mockResolvedValueOnce({ _sum: { amount: decimal("1500") } })
				.mockResolvedValueOnce({ _sum: { amount: null } });

			const result = await service.findAllByProfile("p1", {});

			expect(result.budgets[0].periodExpenses).toBe(1500);
			expect(result.budgets[0].percentage).toBe(150);
		});

		it("returns zeros without querying transactions when a budget has no EXPENSE items", async () => {
			prisma.budget.findMany.mockResolvedValue([mockBudget({ items: [incomeItem()] })]);

			const result = await service.findAllByProfile("p1", {});

			expect(result.budgets[0]).toMatchObject({
				totalExpenses: 0,
				periodExpenses: 0,
				percentage: 0,
			});
			expect(prisma.transaction.aggregate).not.toHaveBeenCalled();
		});

		it("computes spent only for the budgets in the current page", async () => {
			prisma.budget.findMany.mockResolvedValue([mockBudget({ id: "b1" })]);
			prisma.budget.count.mockResolvedValue(25);

			const result = await service.findAllByProfile("p1", { perPage: 1 });

			expect(result.budgets).toHaveLength(1);
			// One EXPENSE item on the single page budget → EXPENSE + INSTALLMENT aggregates
			expect(prisma.transaction.aggregate).toHaveBeenCalledTimes(2);
		});

		it("does not create or look up snapshots while listing", async () => {
			const ended = mockBudget({ startDate: new Date("2025-01-01T00:00:00.000Z") });
			prisma.budget.findMany.mockResolvedValue([ended]);
			prisma.budget.count.mockResolvedValue(1);

			await service.findAllByProfile("p1", {});

			expect(prisma.budgetPeriodSnapshot.findUnique).not.toHaveBeenCalled();
			expect(prisma.budgetPeriodSnapshot.create).not.toHaveBeenCalled();
		});
	});

	// ─── findTransactions ──────────────────────────────────────────────

	describe("findTransactions", () => {
		const NOW = new Date("2026-03-15T12:00:00.000Z");

		function incomeItem() {
			return expenseItem({
				id: "item-2",
				categoryId: "c-inc",
				amount: decimal("20000"),
				category: { id: "c-inc", name: "Salary", type: "INCOME" },
			});
		}

		beforeEach(() => {
			jest.useFakeTimers({ now: NOW });
		});

		afterEach(() => {
			jest.useRealTimers();
		});

		it("throws NotFoundException for a budget not owned by the user", async () => {
			prisma.budget.findFirst.mockResolvedValue(null);
			await expect(service.findTransactions("b1", "p2", {})).rejects.toThrow(NotFoundException);
			expect(prisma.budget.findFirst.mock.calls[0][0].where).toEqual({ id: "b1", profileId: "p2" });
			expect(prisma.transaction.findMany).not.toHaveBeenCalled();
		});

		it("builds one OR where with EXPENSE (no MSI purchases), INSTALLMENT and INCOME branches", async () => {
			prisma.budget.findFirst.mockResolvedValue(
				mockBudget({ items: [expenseItem(), incomeItem()] }),
			);

			await service.findTransactions("b1", "p1", {});

			const where = prisma.transaction.findMany.mock.calls[0][0].where;
			expect(where.account).toEqual({ profileId: "p1" });
			expect(where.OR).toEqual([
				{ type: "EXPENSE", categoryId: { in: ["c-exp"] }, installmentPlan: null },
				{ type: "INSTALLMENT", billedPlan: { transaction: { categoryId: { in: ["c-exp"] } } } },
				{ type: "INCOME", categoryId: { in: ["c-inc"] } },
			]);
			expect(where.type).toBeUndefined();
			expect(prisma.transaction.count).toHaveBeenCalledWith({ where });
			expect(prisma.transaction.findMany).toHaveBeenCalledTimes(1);
			expect(prisma.transaction.count).toHaveBeenCalledTimes(1);
		});

		it("defaults the date range to the budget's current period (matches progress)", async () => {
			prisma.budget.findFirst.mockResolvedValue(mockBudget());
			prisma.budgetPeriodSnapshot.findUnique.mockResolvedValue({ id: "existing" });

			await service.findTransactions("b1", "p1", {});
			const progress = await service.getProgress("b1", "p1");

			const where = prisma.transaction.findMany.mock.calls[0][0].where;
			expect(where.date).toEqual({ gte: progress.periodStart, lte: progress.periodEnd });
			expect(where.date.gte).toEqual(new Date("2026-03-01T00:00:00.000Z"));
		});

		it("lets from and to override each bound independently", async () => {
			prisma.budget.findFirst.mockResolvedValue(mockBudget());
			const from = new Date("2026-02-10T00:00:00.000Z");
			const to = new Date("2026-03-05T00:00:00.000Z");

			await service.findTransactions("b1", "p1", {});
			await service.findTransactions("b1", "p1", { from });
			await service.findTransactions("b1", "p1", { to });
			await service.findTransactions("b1", "p1", { from, to });

			const [defaults, onlyFrom, onlyTo, both] = prisma.transaction.findMany.mock.calls.map(
				(call) => call[0].where.date,
			);
			expect(onlyFrom).toEqual({ gte: from, lte: defaults.lte });
			expect(onlyTo).toEqual({ gte: defaults.gte, lte: to });
			expect(both).toEqual({ gte: from, lte: to });
		});

		it("returns an empty page without querying when categoryId is not in the budget", async () => {
			prisma.budget.findFirst.mockResolvedValue(mockBudget());

			const result = await service.findTransactions("b1", "p1", { categoryId: "other" });

			expect(result).toEqual({ data: [], total: 0, page: 1, limit: 50, totalPages: 0 });
			expect(prisma.transaction.findMany).not.toHaveBeenCalled();
			expect(prisma.transaction.count).not.toHaveBeenCalled();
		});

		it("narrows to an EXPENSE categoryId while keeping its installments", async () => {
			prisma.budget.findFirst.mockResolvedValue(
				mockBudget({ items: [expenseItem(), incomeItem()] }),
			);

			await service.findTransactions("b1", "p1", { categoryId: "c-exp", type: "INSTALLMENT" });

			const where = prisma.transaction.findMany.mock.calls[0][0].where;
			expect(where.OR).toEqual([
				{ type: "EXPENSE", categoryId: { in: ["c-exp"] }, installmentPlan: null },
				{ type: "INSTALLMENT", billedPlan: { transaction: { categoryId: { in: ["c-exp"] } } } },
			]);
			expect(where.type).toBe("INSTALLMENT");
		});

		it("applies case-insensitive description search", async () => {
			prisma.budget.findFirst.mockResolvedValue(mockBudget());

			await service.findTransactions("b1", "p1", { search: "super" });

			const where = prisma.transaction.findMany.mock.calls[0][0].where;
			expect(where.description).toEqual({ contains: "super", mode: "insensitive" });
		});

		it("paginates, sorts and returns accounts-style meta", async () => {
			prisma.budget.findFirst.mockResolvedValue(mockBudget());
			prisma.transaction.findMany.mockResolvedValue([{ id: "t1" }]);
			prisma.transaction.count.mockResolvedValue(45);

			const result = await service.findTransactions("b1", "p1", {
				page: 3,
				limit: 20,
				sortBy: "amount",
				order: "asc",
			});

			const call = prisma.transaction.findMany.mock.calls[0][0];
			expect(call.skip).toBe(40);
			expect(call.take).toBe(20);
			expect(call.orderBy).toEqual({ amount: "asc" });
			expect(result).toEqual({
				data: [{ id: "t1" }],
				total: 45,
				page: 3,
				limit: 20,
				totalPages: 3,
			});
		});

		it("caps limit at 100 and defaults to date desc", async () => {
			prisma.budget.findFirst.mockResolvedValue(mockBudget());

			const result = await service.findTransactions("b1", "p1", { limit: 500 });

			const call = prisma.transaction.findMany.mock.calls[0][0];
			expect(call.take).toBe(100);
			expect(call.orderBy).toEqual({ date: "desc" });
			expect(result.limit).toBe(100);
		});

		it("returns an empty page without error for a budget with no items", async () => {
			prisma.budget.findFirst.mockResolvedValue(mockBudget({ items: [] }));

			const result = await service.findTransactions("b1", "p1", {});

			expect(result).toEqual({ data: [], total: 0, page: 1, limit: 50, totalPages: 0 });
			expect(prisma.transaction.findMany).not.toHaveBeenCalled();
		});

		it("allows inactive budgets", async () => {
			prisma.budget.findFirst.mockResolvedValue(mockBudget({ isActive: false }));

			await service.findTransactions("b1", "p1", {});

			expect(prisma.transaction.findMany).toHaveBeenCalledTimes(1);
		});
	});

	// ─── getHistory ────────────────────────────────────────────────────

	describe("getHistory", () => {
		it("throws NotFoundException for a budget not owned by the user", async () => {
			prisma.budget.findFirst.mockResolvedValue(null);
			await expect(service.getHistory("b1", "p1")).rejects.toThrow(NotFoundException);
		});

		it("returns snapshots ordered by periodStart desc", async () => {
			prisma.budget.findFirst.mockResolvedValue(mockBudget());
			prisma.budgetPeriodSnapshot.findUnique.mockResolvedValue({ id: "existing" });
			prisma.budgetPeriodSnapshot.findMany.mockResolvedValue([
				{
					id: "snap-2",
					budgetId: "b1",
					periodStart: new Date("2026-02-01"),
					periodEnd: new Date("2026-02-28T23:59:59.999Z"),
					totalPlanned: decimal("5000"),
					totalSpent: decimal("4000"),
					createdAt: new Date(),
					items: [
						{
							budgetItemId: "item-1",
							categoryId: "c1",
							plannedAmount: decimal("5000"),
							spentAmount: decimal("4000"),
						},
					],
				},
				{
					id: "snap-1",
					budgetId: "b1",
					periodStart: new Date("2026-01-01"),
					periodEnd: new Date("2026-01-31T23:59:59.999Z"),
					totalPlanned: decimal("5000"),
					totalSpent: decimal("3000"),
					createdAt: new Date(),
					items: [
						{
							budgetItemId: "item-1",
							categoryId: "c1",
							plannedAmount: decimal("5000"),
							spentAmount: decimal("3000"),
						},
					],
				},
			]);

			const result = await service.getHistory("b1", "p1");

			const call = prisma.budgetPeriodSnapshot.findMany.mock.calls[0][0];
			expect(call.where).toEqual({ budgetId: "b1" });
			expect(call.orderBy).toEqual({ periodStart: "desc" });
			expect(call.include).toEqual({ items: true });
			expect(result).toHaveLength(2);
			expect(result[0].periodStart).toEqual(new Date("2026-02-01"));
			expect(result[0].totalPlanned).toBe(5000);
			expect(result[0].totalSpent).toBe(4000);
			expect(result[0].items[0]).toEqual({
				budgetItemId: "item-1",
				categoryId: "c1",
				plannedAmount: 5000,
				spentAmount: 4000,
			});
			expect(result[1].periodStart).toEqual(new Date("2026-01-01"));
		});
	});
});

// ─── DTO Validation ────────────────────────────────────────────────────

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

	it("rejects an invalid kind value", async () => {
		const instance = plainToInstance(QueryBudgetsDto, { kind: "WEEKLY" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "kind")).toBe(true);
	});

	it("rejects perPage greater than 100", async () => {
		const instance = plainToInstance(QueryBudgetsDto, { perPage: "101" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "perPage")).toBe(true);
	});

	it("rejects page lower than 1", async () => {
		const instance = plainToInstance(QueryBudgetsDto, { page: "0" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "page")).toBe(true);
	});

	it("accepts valid page and perPage strings", async () => {
		const instance = plainToInstance(QueryBudgetsDto, { page: "2", perPage: "100" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors).toHaveLength(0);
		expect(instance.page).toBe(2);
		expect(instance.perPage).toBe(100);
	});
});
describe("CreateBudgetDto validation", () => {
	const base = {
		name: "Base",
		kind: "RECURRING",
		period: "MONTHLY",
		startDate: "2026-01-01",
	};

	it("accepts a valid payload", async () => {
		const instance = plainToInstance(CreateBudgetDto, {
			...base,
			items: [{ categoryId: "a1b2c3d4-e5f6-4890-abcd-ef1234567890", amount: 100 }],
		});
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors).toHaveLength(0);
	});

	it("rejects empty items", async () => {
		const instance = plainToInstance(CreateBudgetDto, { ...base, items: [] });
		const errors = await validate(instance);
		expect(errors.some((e) => e.property === "items")).toBe(true);
	});

	it("rejects non-UUID categoryId and amount below 0.01", async () => {
		const instance = plainToInstance(CreateBudgetDto, {
			...base,
			items: [{ categoryId: "not-a-uuid", amount: 0 }],
		});
		const errors = await validate(instance);
		const itemErrors = errors.find((e) => e.property === "items")?.children?.[0]?.children ?? [];
		const props = itemErrors.map((e) => e.property);
		expect(props).toEqual(expect.arrayContaining(["categoryId", "amount"]));
	});

	it("accepts optional color and icon strings", async () => {
		const instance = plainToInstance(CreateBudgetDto, {
			...base,
			color: "#0d9488",
			icon: "wallet",
			items: [{ categoryId: "a1b2c3d4-e5f6-4890-abcd-ef1234567890", amount: 100 }],
		});
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors).toHaveLength(0);
	});

	it("rejects non-string color and icon", async () => {
		const instance = plainToInstance(CreateBudgetDto, {
			...base,
			color: 123,
			icon: true,
			items: [{ categoryId: "a1b2c3d4-e5f6-4890-abcd-ef1234567890", amount: 100 }],
		});
		const errors = await validate(instance);
		const props = errors.map((e) => e.property);
		expect(props).toEqual(expect.arrayContaining(["color", "icon"]));
	});
});

describe("UpdateBudgetDto validation", () => {
	it("accepts null color and icon to clear them", async () => {
		const instance = plainToInstance(UpdateBudgetDto, { color: null, icon: null });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors).toHaveLength(0);
	});

	it("rejects non-string color", async () => {
		const instance = plainToInstance(UpdateBudgetDto, { color: 42 });
		const errors = await validate(instance);
		expect(errors.some((e) => e.property === "color")).toBe(true);
	});
});
