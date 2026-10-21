import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
	type BudgetKind,
	type BudgetPeriod,
	type CategoryType,
	Prisma,
	type Transaction,
	type TransactionType,
} from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { BudgetItemInputDto, CreateBudgetDto, UpdateBudgetDto } from "./dto/budget.dto";
import {
	computePeriodRange,
	computePreviousPeriodRange,
	type PeriodRange,
} from "./period-calculator";

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

const BUDGET_ITEMS_INCLUDE = {
	items: {
		include: {
			category: { select: { id: true, name: true, type: true } },
		},
	},
} as const satisfies Prisma.BudgetInclude;

/** A budget with its items and their categories loaded. */
export type BudgetWithItems = Prisma.BudgetGetPayload<{ include: typeof BUDGET_ITEMS_INCLUDE }>;

type BudgetItemWithCategory = BudgetWithItems["items"][number];

/** Per-item progress in a budget period. */
export interface BudgetItemProgress {
	categoryId: string;
	categoryName: string;
	categoryType: CategoryType;
	plannedAmount: number;
	spentAmount: number;
	remaining: number;
	percentage: number;
}

/** Progress for one budget in its current (or last) period. */
export interface BudgetProgress {
	id: string;
	name: string;
	color: string | null;
	icon: string | null;
	kind: BudgetKind;
	period: BudgetPeriod | null;
	periodStart: Date;
	periodEnd: Date;
	totalPlanned: number;
	totalSpent: number;
	totalRemaining: number;
	totalPercentage: number;
	items: BudgetItemProgress[];
}

/** History entry built from a period snapshot. */
export interface BudgetHistoryEntry {
	id: string;
	periodStart: Date;
	periodEnd: Date;
	totalPlanned: number;
	totalSpent: number;
	items: Array<{
		budgetItemId: string;
		categoryId: string;
		plannedAmount: number;
		spentAmount: number;
	}>;
	createdAt: Date;
}

export interface BudgetFilters {
	isActive?: boolean;
	kind?: BudgetKind;
	period?: BudgetPeriod;
	sortBy?: "startDate" | "name" | "createdAt";
	order?: "asc" | "desc";
	page?: number;
	perPage?: number;
	search?: string;
}

/** Planned totals across all budgets matching the list filters. */
export interface BudgetsInfo {
	totalExpenses: number;
	totalIncomes: number;
}

/**
 * A listed budget with EXPENSE-only progress for its current period.
 * INCOME items are ignored for these fields.
 */
export type BudgetListItem = BudgetWithItems & {
	totalExpenses: number;
	periodExpenses: number;
	percentage: number;
};

export interface BudgetsListResult {
	budgets: BudgetListItem[];
	info: BudgetsInfo;
	page: number;
	perPage: number;
	total: number;
	totalPages: number;
}

export interface BudgetTransactionFilters {
	type?: TransactionType;
	categoryId?: string;
	search?: string;
	from?: Date;
	to?: Date;
	page?: number;
	limit?: number;
	sortBy?: "date" | "amount" | "createdAt";
	order?: "asc" | "desc";
}

/** Same shape as `AccountsService.findTransactions`. */
export interface BudgetTransactionsResult {
	data: Transaction[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}

/** Internal Decimal-precision spent computation for one item. */
interface ItemSpent {
	item: BudgetItemWithCategory;
	planned: Decimal;
	spent: Decimal;
}

@Injectable()
export class BudgetsService {
	constructor(private readonly prisma: PrismaService) {}

	// ─── CRUD ──────────────────────────────────────────────────────────

	async findAllByProfile(profileId: string, filters?: BudgetFilters): Promise<BudgetsListResult> {
		const isActive = filters?.isActive ?? true;
		const sortBy = filters?.sortBy ?? "startDate";
		const order = filters?.order ?? "desc";
		const page = filters?.page ?? 1;
		const perPage = filters?.perPage ?? 10;

		const where: Prisma.BudgetWhereInput = {
			profileId,
			isActive,
			...(filters?.kind ? { kind: filters.kind } : {}),
			...(filters?.period ? { period: filters.period } : {}),
			...(filters?.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
		};

		const now = new Date();
		const [budgets, total, info] = await Promise.all([
			this.prisma.budget.findMany({
				where,
				orderBy: { [sortBy]: order },
				skip: (page - 1) * perPage,
				take: perPage,
				include: BUDGET_ITEMS_INCLUDE,
			}),
			this.prisma.budget.count({ where }),
			this.computePlannedInfo(where),
		]);

		return {
			budgets: await Promise.all(
				budgets.map((budget) => this.withExpenseProgress(budget, profileId, now)),
			),
			info,
			page,
			perPage,
			total,
			totalPages: Math.ceil(total / perPage) || 1,
		};
	}

	async findOne(id: string, profileId: string): Promise<BudgetWithItems> {
		const budget = await this.prisma.budget.findFirst({
			where: { id, profileId },
			include: BUDGET_ITEMS_INCLUDE,
		});
		if (!budget) {
			throw new NotFoundException("Budget not found");
		}
		return budget;
	}

	async create(profileId: string, dto: CreateBudgetDto): Promise<BudgetWithItems> {
		const startDate = new Date(dto.startDate);
		const endDate = dto.endDate ? new Date(dto.endDate) : null;
		this.validateSchedule(dto.kind, dto.period ?? null, startDate, endDate);
		await this.validateItems(profileId, dto.items);

		return this.prisma.budget.create({
			data: {
				profileId,
				name: dto.name,
				color: dto.color ?? null,
				icon: dto.icon ?? null,
				kind: dto.kind,
				period: dto.period ?? null,
				startDate,
				endDate,
				items: { create: this.toItemCreateData(dto.items) },
			},
			include: BUDGET_ITEMS_INCLUDE,
		});
	}

	async update(id: string, profileId: string, dto: UpdateBudgetDto): Promise<BudgetWithItems> {
		const existing = await this.findOne(id, profileId);

		const kind = dto.kind ?? existing.kind;
		const period = dto.period !== undefined ? dto.period : existing.period;
		const startDate = dto.startDate !== undefined ? new Date(dto.startDate) : existing.startDate;
		const endDate =
			dto.endDate !== undefined ? (dto.endDate ? new Date(dto.endDate) : null) : existing.endDate;
		this.validateSchedule(kind, period, startDate, endDate);

		const data: Prisma.BudgetUpdateInput = {
			...(dto.name !== undefined ? { name: dto.name } : {}),
			...(dto.color !== undefined ? { color: dto.color } : {}),
			...(dto.icon !== undefined ? { icon: dto.icon } : {}),
			...(dto.kind !== undefined ? { kind: dto.kind } : {}),
			...(dto.period !== undefined ? { period: dto.period } : {}),
			...(dto.startDate !== undefined ? { startDate } : {}),
			...(dto.endDate !== undefined ? { endDate } : {}),
			...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
		};

		const items = dto.items;
		if (!items) {
			return this.prisma.budget.update({ where: { id }, data, include: BUDGET_ITEMS_INCLUDE });
		}

		await this.validateItems(profileId, items);

		return this.prisma.$transaction(async (tx) => {
			await tx.budgetItem.deleteMany({ where: { budgetId: id } });
			return tx.budget.update({
				where: { id },
				data: { ...data, items: { create: this.toItemCreateData(items) } },
				include: BUDGET_ITEMS_INCLUDE,
			});
		});
	}

	async remove(id: string, profileId: string): Promise<void> {
		await this.findOne(id, profileId);
		await this.prisma.budget.update({
			where: { id },
			data: { isActive: false },
		});
	}

	// ─── Transactions ──────────────────────────────────────────────────

	/**
	 * Transactions counted by the budget's items, using the same rules as progress.
	 * Range defaults to the current period; `from`/`to` override each bound.
	 * A `categoryId` outside the budget yields an empty page.
	 */
	async findTransactions(
		id: string,
		profileId: string,
		filters: BudgetTransactionFilters,
	): Promise<BudgetTransactionsResult> {
		const budget = await this.findOne(id, profileId);

		const page = filters.page ?? 1;
		const limit = Math.min(filters.limit ?? 50, 100);
		const skip = (page - 1) * limit;
		const sortBy = filters.sortBy ?? "date";
		const order = filters.order ?? "desc";

		const items = filters.categoryId
			? budget.items.filter((item) => item.categoryId === filters.categoryId)
			: budget.items;
		if (items.length === 0) {
			return { data: [], total: 0, page, limit, totalPages: 0 };
		}

		const range = this.currentRange(budget, new Date());
		const expenseIds = items.filter((i) => i.category.type === "EXPENSE").map((i) => i.categoryId);
		const incomeIds = items.filter((i) => i.category.type === "INCOME").map((i) => i.categoryId);

		const where: Prisma.TransactionWhereInput = {
			account: { profileId },
			date: { gte: filters.from ?? range.start, lte: filters.to ?? range.end },
			OR: [
				...(expenseIds.length > 0
					? [expenseWhere({ in: expenseIds }), installmentWhere({ in: expenseIds })]
					: []),
				...(incomeIds.length > 0 ? [incomeWhere({ in: incomeIds })] : []),
			],
			...(filters.type ? { type: filters.type } : {}),
			...(filters.search ? { description: { contains: filters.search, mode: "insensitive" } } : {}),
		};

		const [data, total] = await Promise.all([
			this.prisma.transaction.findMany({
				where,
				skip,
				take: limit,
				orderBy: { [sortBy]: order },
			}),
			this.prisma.transaction.count({ where }),
		]);

		const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

		return { data, total, page, limit, totalPages };
	}

	// ─── Progress ──────────────────────────────────────────────────────

	async getProgress(budgetId: string, profileId: string): Promise<BudgetProgress> {
		const budget = await this.findOne(budgetId, profileId);
		return this.computeProgress(budget, profileId, new Date());
	}

	async getProgressForAll(profileId: string): Promise<BudgetProgress[]> {
		const budgets = await this.prisma.budget.findMany({
			where: { profileId, isActive: true },
			orderBy: { startDate: "desc" },
			include: BUDGET_ITEMS_INCLUDE,
		});

		const now = new Date();
		return Promise.all(budgets.map((budget) => this.computeProgress(budget, profileId, now)));
	}

	// ─── History ───────────────────────────────────────────────────────

	async getHistory(budgetId: string, profileId: string): Promise<BudgetHistoryEntry[]> {
		const budget = await this.findOne(budgetId, profileId);
		await this.createSnapshotIfNeeded(budget, profileId, new Date());

		const snapshots = await this.prisma.budgetPeriodSnapshot.findMany({
			where: { budgetId: budget.id },
			orderBy: { periodStart: "desc" },
			include: { items: true },
		});

		return snapshots.map((snap) => ({
			id: snap.id,
			periodStart: snap.periodStart,
			periodEnd: snap.periodEnd,
			totalPlanned: snap.totalPlanned.toNumber(),
			totalSpent: snap.totalSpent.toNumber(),
			items: snap.items.map((item) => ({
				budgetItemId: item.budgetItemId,
				categoryId: item.categoryId,
				plannedAmount: item.plannedAmount.toNumber(),
				spentAmount: item.spentAmount.toNumber(),
			})),
			createdAt: snap.createdAt,
		}));
	}

	// ─── Internals: progress ───────────────────────────────────────────

	private async computeProgress(
		budget: BudgetWithItems,
		profileId: string,
		now: Date,
	): Promise<BudgetProgress> {
		await this.createSnapshotIfNeeded(budget, profileId, now);

		const range = this.currentRange(budget, now);
		const spent = await this.computeItemsSpent(budget.items, profileId, range);

		const totalPlanned = spent.reduce((sum, s) => sum.add(s.planned), new Decimal(0));
		const totalSpent = spent.reduce((sum, s) => sum.add(s.spent), new Decimal(0));

		return {
			id: budget.id,
			name: budget.name,
			color: budget.color,
			icon: budget.icon,
			kind: budget.kind,
			period: budget.period,
			periodStart: range.start,
			periodEnd: range.end,
			totalPlanned: totalPlanned.toNumber(),
			totalSpent: totalSpent.toNumber(),
			totalRemaining: totalPlanned.sub(totalSpent).toNumber(),
			totalPercentage: percentage(totalSpent, totalPlanned),
			items: spent.map(({ item, planned, spent: itemSpent }) => ({
				categoryId: item.categoryId,
				categoryName: item.category.name,
				categoryType: item.category.type,
				plannedAmount: planned.toNumber(),
				spentAmount: itemSpent.toNumber(),
				remaining: planned.sub(itemSpent).toNumber(),
				percentage: percentage(itemSpent, planned),
			})),
		};
	}

	/**
	 * Planned EXPENSE/INCOME item amounts summed across every budget matching `where`.
	 * DB aggregates only — no transaction queries.
	 */
	private async computePlannedInfo(where: Prisma.BudgetWhereInput): Promise<BudgetsInfo> {
		const [expenses, incomes] = await Promise.all([
			this.prisma.budgetItem.aggregate({
				_sum: { amount: true },
				where: { budget: where, category: { type: "EXPENSE" } },
			}),
			this.prisma.budgetItem.aggregate({
				_sum: { amount: true },
				where: { budget: where, category: { type: "INCOME" } },
			}),
		]);

		return {
			totalExpenses: toDecimal(expenses._sum.amount).toDecimalPlaces(2).toNumber(),
			totalIncomes: toDecimal(incomes._sum.amount).toDecimalPlaces(2).toNumber(),
		};
	}

	/**
	 * Planned vs actual for the budget's EXPENSE items in its current period.
	 * Read-only: never creates snapshots.
	 */
	private async withExpenseProgress(
		budget: BudgetWithItems,
		profileId: string,
		now: Date,
	): Promise<BudgetListItem> {
		const expenseItems = budget.items.filter((item) => item.category.type === "EXPENSE");
		const spent =
			expenseItems.length > 0
				? await this.computeItemsSpent(expenseItems, profileId, this.currentRange(budget, now))
				: [];

		const totalExpenses = spent.reduce((sum, s) => sum.add(s.planned), new Decimal(0));
		const periodExpenses = spent.reduce((sum, s) => sum.add(s.spent), new Decimal(0));

		return {
			...budget,
			totalExpenses: totalExpenses.toDecimalPlaces(2).toNumber(),
			periodExpenses: periodExpenses.toDecimalPlaces(2).toNumber(),
			percentage: percentage(periodExpenses, totalExpenses),
		};
	}

	/**
	 * Current period for a budget. For RECURRING budgets whose endDate has passed,
	 * the period containing endDate is returned (informational), clamped to endDate.
	 */
	private currentRange(budget: BudgetWithItems, now: Date): PeriodRange {
		const reference = this.referenceDate(budget, now);
		const range = computePeriodRange(
			budget.kind,
			budget.period,
			budget.startDate,
			budget.endDate,
			reference,
		);
		if (budget.kind === "RECURRING" && budget.endDate && range.end > budget.endDate) {
			return { start: range.start, end: new Date(budget.endDate) };
		}
		return range;
	}

	private referenceDate(budget: BudgetWithItems, now: Date): Date {
		if (budget.kind === "RECURRING" && budget.endDate && now > budget.endDate) {
			return new Date(budget.endDate);
		}
		return now;
	}

	/**
	 * Spent per item in the range, scoped to the user's accounts.
	 *
	 * EXPENSE category: EXPENSE tx with that category that are NOT installment-plan purchases
	 *   + INSTALLMENT tx whose plan's purchase transaction has that category.
	 * INCOME category: INCOME tx with that category.
	 * TRANSFER / PAYMENT are never counted.
	 */
	private async computeItemsSpent(
		items: BudgetItemWithCategory[],
		profileId: string,
		range: PeriodRange,
	): Promise<ItemSpent[]> {
		const baseWhere = {
			account: { profileId },
			date: { gte: range.start, lte: range.end },
		} satisfies Prisma.TransactionWhereInput;

		return Promise.all(
			items.map(async (item) => {
				const planned = new Decimal(item.amount);

				if (item.category.type === "INCOME") {
					const income = await this.prisma.transaction.aggregate({
						_sum: { amount: true },
						where: { ...baseWhere, ...incomeWhere(item.categoryId) },
					});
					return { item, planned, spent: toDecimal(income._sum.amount) };
				}

				const [expense, installments] = await Promise.all([
					this.prisma.transaction.aggregate({
						_sum: { amount: true },
						where: { ...baseWhere, ...expenseWhere(item.categoryId) },
					}),
					this.prisma.transaction.aggregate({
						_sum: { amount: true },
						where: { ...baseWhere, ...installmentWhere(item.categoryId) },
					}),
				]);

				return {
					item,
					planned,
					spent: toDecimal(expense._sum.amount).add(toDecimal(installments._sum.amount)),
				};
			}),
		);
	}

	// ─── Internals: snapshots ──────────────────────────────────────────

	/**
	 * Lazily persist the immediately previous period once it has ended.
	 * Idempotent: skips existing snapshots and swallows unique races (P2002).
	 */
	private async createSnapshotIfNeeded(
		budget: BudgetWithItems,
		profileId: string,
		now: Date,
	): Promise<void> {
		if (budget.kind !== "RECURRING" || budget.items.length === 0) {
			return;
		}

		const previous = computePreviousPeriodRange(
			budget.kind,
			budget.period,
			budget.startDate,
			budget.endDate,
			this.referenceDate(budget, now),
		);
		if (!previous || previous.start < budget.startDate || previous.end >= now) {
			return;
		}

		const existing = await this.prisma.budgetPeriodSnapshot.findUnique({
			where: { budgetId_periodStart: { budgetId: budget.id, periodStart: previous.start } },
			select: { id: true },
		});
		if (existing) {
			return;
		}

		const spent = await this.computeItemsSpent(budget.items, profileId, previous);
		const totalPlanned = spent.reduce((sum, s) => sum.add(s.planned), new Decimal(0));
		const totalSpent = spent.reduce((sum, s) => sum.add(s.spent), new Decimal(0));

		try {
			await this.prisma.budgetPeriodSnapshot.create({
				data: {
					budgetId: budget.id,
					periodStart: previous.start,
					periodEnd: previous.end,
					totalPlanned,
					totalSpent,
					items: {
						createMany: {
							data: spent.map((s) => ({
								budgetItemId: s.item.id,
								categoryId: s.item.categoryId,
								plannedAmount: s.planned,
								spentAmount: s.spent,
							})),
						},
					},
				},
			});
		} catch (error) {
			if (!isUniqueViolation(error)) {
				throw error;
			}
		}
	}

	// ─── Validation ────────────────────────────────────────────────────

	/**
	 * RECURRING: period required, endDate optional.
	 * ONE_TIME: period must be null, endDate required.
	 * Whenever endDate is set it must be after startDate.
	 */
	private validateSchedule(
		kind: BudgetKind,
		period: BudgetPeriod | null,
		startDate: Date,
		endDate: Date | null,
	): void {
		if (kind === "RECURRING" && !period) {
			throw new BadRequestException("RECURRING budget requires a period");
		}
		if (kind === "ONE_TIME") {
			if (period) {
				throw new BadRequestException("ONE_TIME budget must not have a period");
			}
			if (!endDate) {
				throw new BadRequestException("ONE_TIME budget requires an endDate");
			}
		}
		if (endDate && endDate.getTime() <= startDate.getTime()) {
			throw new BadRequestException("endDate must be after startDate");
		}
	}

	/** Items must reference distinct categories owned by the user (INCOME or EXPENSE). */
	private async validateItems(profileId: string, items: BudgetItemInputDto[]): Promise<void> {
		const categoryIds = items.map((item) => item.categoryId);
		const unique = new Set(categoryIds);
		if (unique.size !== categoryIds.length) {
			throw new BadRequestException("Duplicate categoryId in budget items");
		}

		const categories = await this.prisma.category.findMany({
			where: { id: { in: [...unique] }, profileId },
			select: { id: true },
		});
		const found = new Set(categories.map((c) => c.id));
		const missing = categoryIds.find((id) => !found.has(id));
		if (missing) {
			throw new NotFoundException(`Category ${missing} not found`);
		}
	}

	private toItemCreateData(items: BudgetItemInputDto[]) {
		return items.map((item) => ({ categoryId: item.categoryId, amount: item.amount }));
	}
}

// ─── Budget transaction rules (shared by progress and the transactions list) ──

type CategoryIdFilter = string | Prisma.StringFilter;

/** Direct EXPENSE tx in the category, excluding installment-plan (MSI) purchases. */
function expenseWhere(categoryId: CategoryIdFilter): Prisma.TransactionWhereInput {
	return { type: "EXPENSE", categoryId, installmentPlan: null };
}

/** INSTALLMENT tx whose plan's purchase transaction is in the category. */
function installmentWhere(categoryId: CategoryIdFilter): Prisma.TransactionWhereInput {
	return { type: "INSTALLMENT", billedPlan: { transaction: { categoryId } } };
}

/** INCOME tx in the category. */
function incomeWhere(categoryId: CategoryIdFilter): Prisma.TransactionWhereInput {
	return { type: "INCOME", categoryId };
}

function toDecimal(value: Decimal | null): Decimal {
	return value ? new Decimal(value) : new Decimal(0);
}

function percentage(spent: Decimal, planned: Decimal): number {
	if (planned.lte(0)) {
		return 0;
	}
	return spent.div(planned).mul(100).round().toNumber();
}

function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code: unknown }).code === "P2002"
	);
}
