import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import type { IncomeSourceWithProfile } from "./income-generation.service";
import { IncomeGenerationService } from "./income-generation.service";

type MockPrisma = {
	incomeSource: {
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

const makeSource = (
	overrides: Partial<Omit<IncomeSourceWithProfile, "profile">> & { timezone?: string } = {},
): IncomeSourceWithProfile => {
	const { timezone, ...rest } = overrides;
	return {
		id: "src-1",
		profileId: "p1",
		name: "Salary",
		amount: 5000,
		frequency: "MONTHLY",
		paydays: [15],
		destinationAccountId: "acct-1",
		categoryId: "cat-1",
		lastGeneratedAt: null,
		isActive: true,
		createdAt: new Date("2025-01-01T00:00:00Z"),
		updatedAt: new Date("2025-01-01T00:00:00Z"),
		profile: { timezone: timezone ?? "UTC" },
		...rest,
	} as unknown as IncomeSourceWithProfile;
};

const createdDates = (prisma: MockPrisma): string[] =>
	prisma.transaction.create.mock.calls.map(([arg]: [{ data: { date: Date } }]) =>
		arg.data.date.toISOString(),
	);

describe("IncomeGenerationService", () => {
	let service: IncomeGenerationService;
	let prisma: MockPrisma;

	beforeEach(async () => {
		prisma = {
			incomeSource: {
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
			providers: [IncomeGenerationService, { provide: PrismaService, useValue: prisma }],
		}).compile();
		service = module.get(IncomeGenerationService);
	});

	describe("calculatePaydays", () => {
		it("WEEKLY: finds all Fridays (5) in January 2025, inclusive bounds", () => {
			expect(service.calculatePaydays("WEEKLY", [5], "2025-01-01", "2025-01-31")).toEqual([
				"2025-01-03",
				"2025-01-10",
				"2025-01-17",
				"2025-01-24",
				"2025-01-31",
			]);
		});

		it("WEEKLY: 7 means Sunday", () => {
			expect(service.calculatePaydays("WEEKLY", [7], "2025-01-01", "2025-01-12")).toEqual([
				"2025-01-05",
				"2025-01-12",
			]);
		});

		it("BIWEEKLY: 15 and 30 clamp to Feb 28", () => {
			expect(service.calculatePaydays("BIWEEKLY", [15, 30], "2025-01-01", "2025-03-01")).toEqual([
				"2025-01-15",
				"2025-01-30",
				"2025-02-15",
				"2025-02-28",
			]);
		});

		it("MONTHLY: day 31 clamps to the last day of each month (leap year)", () => {
			expect(service.calculatePaydays("MONTHLY", [31], "2024-01-01", "2024-04-30")).toEqual([
				"2024-01-31",
				"2024-02-29",
				"2024-03-31",
				"2024-04-30",
			]);
		});

		it("returns nothing for an inverted range or invalid paydays", () => {
			expect(service.calculatePaydays("MONTHLY", [15], "2025-02-01", "2025-01-01")).toEqual([]);
			expect(service.calculatePaydays("WEEKLY", [8], "2025-01-01", "2025-01-31")).toEqual([]);
			expect(service.calculatePaydays("BIWEEKLY", [1], "2025-01-01", "2025-01-31")).toEqual([]);
		});
	});

	describe("generateForSource", () => {
		it("backfills from createdAt up to today and credits the destination account", async () => {
			const source = makeSource({ createdAt: new Date("2025-01-01T10:00:00Z") });

			const created = await service.generateForSource(source, new Date("2025-03-20T09:00:00Z"));

			expect(created).toBe(3);
			expect(createdDates(prisma)).toEqual([
				"2025-01-15T12:00:00.000Z",
				"2025-02-15T12:00:00.000Z",
				"2025-03-15T12:00:00.000Z",
			]);
			expect(prisma.transaction.create).toHaveBeenCalledWith({
				data: {
					accountId: "acct-1",
					type: "INCOME",
					amount: 5000,
					categoryId: "cat-1",
					incomeSourceId: "src-1",
					date: new Date("2025-01-15T12:00:00Z"),
					description: "Salary",
				},
			});
			expect(prisma.account.update).toHaveBeenCalledWith({
				where: { id: "acct-1" },
				data: { balance: { increment: 5000 } },
			});
			// Each payday is atomic: create + balance + cursor in one $transaction.
			expect(prisma.$transaction).toHaveBeenCalledTimes(3);
			expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(3);
		});

		it("includes a payday that is today", async () => {
			const created = await service.generateForSource(
				makeSource({ createdAt: new Date("2025-03-01T00:00:00Z") }),
				new Date("2025-03-15T03:00:00Z"),
			);
			expect(created).toBe(1);
		});

		it("never generates paydays before createdAt", async () => {
			const created = await service.generateForSource(
				makeSource({ createdAt: new Date("2025-02-16T00:00:00Z") }),
				new Date("2025-03-01T00:00:00Z"),
			);
			expect(created).toBe(0);
			expect(prisma.transaction.create).not.toHaveBeenCalled();
		});

		it("resumes after lastGeneratedAt (exclusive), so deleted incomes are not recreated", async () => {
			const created = await service.generateForSource(
				makeSource({ lastGeneratedAt: new Date("2025-02-15T12:00:00Z") }),
				new Date("2025-03-20T09:00:00Z"),
			);
			expect(created).toBe(1);
			expect(createdDates(prisma)).toEqual(["2025-03-15T12:00:00.000Z"]);
		});

		it("does nothing when the cursor is already at or after today", async () => {
			const created = await service.generateForSource(
				makeSource({ lastGeneratedAt: new Date("2025-03-20T01:00:00Z") }),
				new Date("2025-03-20T09:00:00Z"),
			);
			expect(created).toBe(0);
			expect(prisma.incomeSource.update).not.toHaveBeenCalled();
		});

		it("advances the cursor to now even when no payday fell in range", async () => {
			const now = new Date("2025-01-10T09:00:00Z");
			await service.generateForSource(makeSource(), now);
			expect(prisma.incomeSource.update).toHaveBeenLastCalledWith({
				where: { id: "src-1" },
				data: { lastGeneratedAt: now },
			});
		});

		it("uses the profile timezone for day boundaries (America/Mexico_City, UTC-6)", async () => {
			// 2025-03-15T03:00Z is still March 14 in Mexico City: the 15th is not due yet.
			const notYet = await service.generateForSource(
				makeSource({
					timezone: "America/Mexico_City",
					createdAt: new Date("2025-03-01T12:00:00Z"),
				}),
				new Date("2025-03-15T03:00:00Z"),
			);
			expect(notYet).toBe(0);

			const due = await service.generateForSource(
				makeSource({
					timezone: "America/Mexico_City",
					createdAt: new Date("2025-03-01T12:00:00Z"),
				}),
				new Date("2025-03-15T07:00:00Z"),
			);
			expect(due).toBe(1);
			// Stored at local noon (12:00 UTC-6) so the calendar day is preserved.
			expect(createdDates(prisma)).toEqual(["2025-03-15T18:00:00.000Z"]);
		});

		it("does not regenerate the cursor's own local day in a negative-offset timezone", async () => {
			// Cursor at local noon of Feb 15 (Mexico City) = 18:00Z.
			const created = await service.generateForSource(
				makeSource({
					timezone: "America/Mexico_City",
					lastGeneratedAt: new Date("2025-02-15T18:00:00Z"),
				}),
				new Date("2025-02-20T09:00:00Z"),
			);
			expect(created).toBe(0);
		});

		it("falls back to UTC when the profile timezone is invalid", async () => {
			const created = await service.generateForSource(
				makeSource({ timezone: "Not/AZone", createdAt: new Date("2025-01-01T00:00:00Z") }),
				new Date("2025-01-15T00:30:00Z"),
			);
			expect(created).toBe(1);
		});

		it("creates the transaction without category when the source has none", async () => {
			await service.generateForSource(
				makeSource({ categoryId: null }),
				new Date("2025-01-20T00:00:00Z"),
			);
			expect(prisma.transaction.create).toHaveBeenCalledWith(
				expect.objectContaining({ data: expect.objectContaining({ categoryId: null }) }),
			);
		});

		it("skips paydays that already have a generated transaction but still moves the cursor", async () => {
			prisma.transaction.findFirst.mockResolvedValue({ id: "existing-tx" });

			const created = await service.generateForSource(
				makeSource(),
				new Date("2025-01-20T00:00:00Z"),
			);

			expect(created).toBe(0);
			expect(prisma.transaction.create).not.toHaveBeenCalled();
			expect(prisma.$transaction).not.toHaveBeenCalled();
			expect(prisma.incomeSource.update).toHaveBeenCalledWith({
				where: { id: "src-1" },
				data: { lastGeneratedAt: new Date("2025-01-15T12:00:00Z") },
			});
		});
	});

	describe("generatePendingIncomes", () => {
		it("logs per-source failures without aborting the remaining sources", async () => {
			prisma.incomeSource.findMany.mockResolvedValue([
				makeSource({ id: "broken" }),
				makeSource({ id: "ok" }),
			]);
			prisma.$transaction
				.mockRejectedValueOnce(new Error("db down"))
				.mockImplementation((ops: unknown[]) => Promise.resolve(ops));

			const total = await service.generatePendingIncomes(
				undefined,
				new Date("2025-01-20T00:00:00Z"),
			);

			expect(total).toBe(1);
			expect(prisma.$transaction).toHaveBeenCalledTimes(2);
		});

		it("scopes the query to a profile when requested", async () => {
			await service.generateForProfile("p1", new Date("2025-01-20T00:00:00Z"));
			expect(prisma.incomeSource.findMany).toHaveBeenCalledWith({
				where: { isActive: true, profileId: "p1" },
				include: { profile: { select: { timezone: true } } },
			});
		});
	});
});
