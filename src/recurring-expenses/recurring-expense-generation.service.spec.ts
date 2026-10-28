import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import type { RecurringExpenseWithProfile } from "./recurring-expense-generation.service";
import { RecurringExpenseGenerationService } from "./recurring-expense-generation.service";

type MockPrisma = {
	recurringExpense: {
		findMany: jest.Mock;
		update: jest.Mock;
	};
	transaction: {
		findFirst: jest.Mock;
		create: jest.Mock;
	};
	account: {
		update: jest.Mock;
	};
	$transaction: jest.Mock;
};

const makeExpense = (
	overrides: Partial<Omit<RecurringExpenseWithProfile, "profile" | "account">> & {
		timezone?: string;
		accountType?: string;
	} = {},
): RecurringExpenseWithProfile => {
	const { timezone, accountType, ...rest } = overrides;
	return {
		id: "exp-1",
		profileId: "p1",
		name: "Netflix",
		amount: 199,
		frequency: "MONTHLY",
		billingDays: [15],
		type: "SUBSCRIPTION",
		accountId: "acct-1",
		categoryId: "cat-1",
		url: null,
		color: null,
		icon: null,
		isActive: true,
		lastGeneratedAt: null,
		createdAt: new Date("2025-01-01T00:00:00Z"),
		updatedAt: new Date("2025-01-01T00:00:00Z"),
		profile: { timezone: timezone ?? "UTC" },
		account: { type: accountType ?? "DEBIT" },
		...rest,
	} as unknown as RecurringExpenseWithProfile;
};

const createdDates = (prisma: MockPrisma): string[] =>
	prisma.transaction.create.mock.calls.map(([arg]: [{ data: { date: Date } }]) =>
		arg.data.date.toISOString(),
	);

describe("RecurringExpenseGenerationService", () => {
	let service: RecurringExpenseGenerationService;
	let prisma: MockPrisma;

	beforeEach(async () => {
		prisma = {
			recurringExpense: {
				findMany: jest.fn().mockResolvedValue([]),
				update: jest.fn((arg: unknown) => ({ op: "cursor", arg })),
			},
			transaction: {
				findFirst: jest.fn().mockResolvedValue(null),
				create: jest.fn((arg: unknown) => ({ op: "create", arg })),
			},
			account: {
				update: jest.fn((arg: unknown) => ({ op: "balance", arg })),
			},
			$transaction: jest.fn((ops: unknown[]) => Promise.resolve(ops)),
		};
		const module: TestingModule = await Test.createTestingModule({
			providers: [RecurringExpenseGenerationService, { provide: PrismaService, useValue: prisma }],
		}).compile();
		service = module.get(RecurringExpenseGenerationService);
	});

	describe("calculateBillingDays", () => {
		it("WEEKLY: finds all Fridays (5) in January 2025, inclusive bounds", () => {
			expect(service.calculateBillingDays("WEEKLY", [5], "2025-01-01", "2025-01-31", 1)).toEqual([
				"2025-01-03",
				"2025-01-10",
				"2025-01-17",
				"2025-01-24",
				"2025-01-31",
			]);
		});

		it("WEEKLY: 7 means Sunday", () => {
			expect(service.calculateBillingDays("WEEKLY", [7], "2025-01-01", "2025-01-12", 1)).toEqual([
				"2025-01-05",
				"2025-01-12",
			]);
		});

		it("BIWEEKLY: 15 and 30 clamp to Feb 28", () => {
			expect(
				service.calculateBillingDays("BIWEEKLY", [15, 30], "2025-01-01", "2025-03-01", 1),
			).toEqual(["2025-01-15", "2025-01-30", "2025-02-15", "2025-02-28"]);
		});

		it("MONTHLY: day 31 clamps to the last day of each month (leap year)", () => {
			expect(service.calculateBillingDays("MONTHLY", [31], "2024-01-01", "2024-04-30", 1)).toEqual([
				"2024-01-31",
				"2024-02-29",
				"2024-03-31",
				"2024-04-30",
			]);
		});

		it("YEARLY: fires on the createdAt month + billing day, once per year", () => {
			// createdAt month = March (3), billing day = 15
			expect(service.calculateBillingDays("YEARLY", [15], "2025-01-01", "2027-06-01", 3)).toEqual([
				"2025-03-15",
				"2026-03-15",
				"2027-03-15",
			]);
		});

		it("YEARLY: day 31 clamps to month length", () => {
			// February (month 2), day 31 → Feb 28 (2025, non-leap)
			expect(service.calculateBillingDays("YEARLY", [31], "2025-01-01", "2025-12-31", 2)).toEqual([
				"2025-02-28",
			]);
		});

		it("YEARLY: does not fire before from date", () => {
			expect(service.calculateBillingDays("YEARLY", [15], "2025-03-16", "2025-12-31", 3)).toEqual(
				[],
			);
		});

		it("returns nothing for an inverted range or invalid billing days", () => {
			expect(service.calculateBillingDays("MONTHLY", [15], "2025-02-01", "2025-01-01", 1)).toEqual(
				[],
			);
			expect(service.calculateBillingDays("WEEKLY", [8], "2025-01-01", "2025-01-31", 1)).toEqual(
				[],
			);
			expect(service.calculateBillingDays("BIWEEKLY", [1], "2025-01-01", "2025-01-31", 1)).toEqual(
				[],
			);
		});
	});

	describe("generateForExpense", () => {
		it("backfills from createdAt up to today and charges the account (DEBIT: decrement)", async () => {
			const expense = makeExpense({ createdAt: new Date("2025-01-01T10:00:00Z") });

			const created = await service.generateForExpense(expense, new Date("2025-03-20T09:00:00Z"));

			expect(created).toBe(3);
			expect(createdDates(prisma)).toEqual([
				"2025-01-15T12:00:00.000Z",
				"2025-02-15T12:00:00.000Z",
				"2025-03-15T12:00:00.000Z",
			]);
			expect(prisma.transaction.create).toHaveBeenCalledWith({
				data: {
					accountId: "acct-1",
					type: "EXPENSE",
					amount: 199,
					categoryId: "cat-1",
					recurringExpenseId: "exp-1",
					date: new Date("2025-01-15T12:00:00Z"),
					description: "Netflix",
				},
			});
			expect(prisma.account.update).toHaveBeenCalledWith({
				where: { id: "acct-1" },
				data: { balance: { decrement: 199 } },
			});
			expect(prisma.$transaction).toHaveBeenCalledTimes(3);
			expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(3);
		});

		it("charges CREDIT accounts with increment (more debt)", async () => {
			const expense = makeExpense({
				accountType: "CREDIT",
				createdAt: new Date("2025-01-01T00:00:00Z"),
			});

			await service.generateForExpense(expense, new Date("2025-01-20T00:00:00Z"));

			expect(prisma.account.update).toHaveBeenCalledWith({
				where: { id: "acct-1" },
				data: { balance: { increment: 199 } },
			});
		});

		it("charges LOAN accounts with increment (more debt)", async () => {
			const expense = makeExpense({
				accountType: "LOAN",
				createdAt: new Date("2025-01-01T00:00:00Z"),
			});

			await service.generateForExpense(expense, new Date("2025-01-20T00:00:00Z"));

			expect(prisma.account.update).toHaveBeenCalledWith({
				where: { id: "acct-1" },
				data: { balance: { increment: 199 } },
			});
		});

		it("includes a billing day that is today", async () => {
			const created = await service.generateForExpense(
				makeExpense({ createdAt: new Date("2025-03-01T00:00:00Z") }),
				new Date("2025-03-15T03:00:00Z"),
			);
			expect(created).toBe(1);
		});

		it("never generates billing days before createdAt", async () => {
			const created = await service.generateForExpense(
				makeExpense({ createdAt: new Date("2025-02-16T00:00:00Z") }),
				new Date("2025-03-01T00:00:00Z"),
			);
			expect(created).toBe(0);
			expect(prisma.transaction.create).not.toHaveBeenCalled();
		});

		it("resumes after lastGeneratedAt (exclusive), so deleted expenses are not recreated", async () => {
			const created = await service.generateForExpense(
				makeExpense({ lastGeneratedAt: new Date("2025-02-15T12:00:00Z") }),
				new Date("2025-03-20T09:00:00Z"),
			);
			expect(created).toBe(1);
			expect(createdDates(prisma)).toEqual(["2025-03-15T12:00:00.000Z"]);
		});

		it("does nothing when the cursor is already at or after today", async () => {
			const created = await service.generateForExpense(
				makeExpense({ lastGeneratedAt: new Date("2025-03-20T01:00:00Z") }),
				new Date("2025-03-20T09:00:00Z"),
			);
			expect(created).toBe(0);
			expect(prisma.recurringExpense.update).not.toHaveBeenCalled();
		});

		it("advances the cursor to now even when no billing day fell in range", async () => {
			const now = new Date("2025-01-10T09:00:00Z");
			await service.generateForExpense(makeExpense(), now);
			expect(prisma.recurringExpense.update).toHaveBeenLastCalledWith({
				where: { id: "exp-1" },
				data: { lastGeneratedAt: now },
			});
		});

		it("uses the profile timezone for day boundaries (America/Mexico_City, UTC-6)", async () => {
			const notYet = await service.generateForExpense(
				makeExpense({
					timezone: "America/Mexico_City",
					createdAt: new Date("2025-03-01T12:00:00Z"),
				}),
				new Date("2025-03-15T03:00:00Z"),
			);
			expect(notYet).toBe(0);

			const due = await service.generateForExpense(
				makeExpense({
					timezone: "America/Mexico_City",
					createdAt: new Date("2025-03-01T12:00:00Z"),
				}),
				new Date("2025-03-15T07:00:00Z"),
			);
			expect(due).toBe(1);
			expect(createdDates(prisma)).toEqual(["2025-03-15T18:00:00.000Z"]);
		});

		it("falls back to UTC when the profile timezone is invalid", async () => {
			const created = await service.generateForExpense(
				makeExpense({ timezone: "Not/AZone", createdAt: new Date("2025-01-01T00:00:00Z") }),
				new Date("2025-01-15T00:30:00Z"),
			);
			expect(created).toBe(1);
		});

		it("creates the transaction without category when the expense has none", async () => {
			await service.generateForExpense(
				makeExpense({ categoryId: null }),
				new Date("2025-01-20T00:00:00Z"),
			);
			expect(prisma.transaction.create).toHaveBeenCalledWith(
				expect.objectContaining({ data: expect.objectContaining({ categoryId: null }) }),
			);
		});

		it("skips billing days that already have a generated transaction but still moves the cursor", async () => {
			prisma.transaction.findFirst.mockResolvedValue({ id: "existing-tx" });

			const created = await service.generateForExpense(
				makeExpense(),
				new Date("2025-01-20T00:00:00Z"),
			);

			expect(created).toBe(0);
			expect(prisma.transaction.create).not.toHaveBeenCalled();
			expect(prisma.$transaction).not.toHaveBeenCalled();
			expect(prisma.recurringExpense.update).toHaveBeenCalledWith({
				where: { id: "exp-1" },
				data: { lastGeneratedAt: new Date("2025-01-15T12:00:00Z") },
			});
		});

		it("YEARLY: generates one transaction per year across multiple years", async () => {
			const expense = makeExpense({
				frequency: "YEARLY",
				billingDays: [15],
				createdAt: new Date("2025-03-01T00:00:00Z"),
			});

			const created = await service.generateForExpense(expense, new Date("2027-06-01T00:00:00Z"));

			expect(created).toBe(3);
			expect(createdDates(prisma)).toEqual([
				"2025-03-15T12:00:00.000Z",
				"2026-03-15T12:00:00.000Z",
				"2027-03-15T12:00:00.000Z",
			]);
		});
	});

	describe("generatePendingExpenses", () => {
		it("logs per-source failures without aborting the remaining sources", async () => {
			prisma.recurringExpense.findMany.mockResolvedValue([
				makeExpense({ id: "broken" }),
				makeExpense({ id: "ok" }),
			]);
			prisma.$transaction
				.mockRejectedValueOnce(new Error("db down"))
				.mockImplementation((ops: unknown[]) => Promise.resolve(ops));

			const total = await service.generatePendingExpenses(
				undefined,
				new Date("2025-01-20T00:00:00Z"),
			);

			expect(total).toBe(1);
			expect(prisma.$transaction).toHaveBeenCalledTimes(2);
		});

		it("scopes the query to a profile when requested", async () => {
			await service.generateForProfile("p1", new Date("2025-01-20T00:00:00Z"));
			expect(prisma.recurringExpense.findMany).toHaveBeenCalledWith({
				where: { isActive: true, profileId: "p1" },
				include: {
					profile: { select: { timezone: true } },
					account: { select: { type: true } },
				},
			});
		});
	});
});
