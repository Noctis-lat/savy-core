import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
	ArrayMinSize,
	IsArray,
	IsBoolean,
	IsBooleanString,
	IsDateString,
	IsEnum,
	IsInt,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	IsUUID,
	Max,
	MaxLength,
	Min,
	ValidateNested,
} from "class-validator";

enum BudgetKind {
	RECURRING = "RECURRING",
	ONE_TIME = "ONE_TIME",
}

enum BudgetPeriod {
	WEEKLY = "WEEKLY",
	BIWEEKLY = "BIWEEKLY",
	MONTHLY = "MONTHLY",
	YEARLY = "YEARLY",
}

enum CategoryType {
	INCOME = "INCOME",
	EXPENSE = "EXPENSE",
}

enum BudgetSortBy {
	name = "name",
	startDate = "startDate",
	createdAt = "createdAt",
}

enum SortOrder {
	asc = "asc",
	desc = "desc",
}

// ─── Request DTOs ──────────────────────────────────────────────────────

export class BudgetItemInputDto {
	@ApiProperty({
		example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		description: "Category ID (INCOME or EXPENSE, must belong to the user)",
	})
	@IsUUID()
	categoryId!: string;

	@ApiProperty({ example: 5000, description: "Planned amount for this category in the period" })
	@Type(() => Number)
	@IsNumber({ maxDecimalPlaces: 2 })
	@Min(0.01)
	amount!: number;
}

export class CreateBudgetDto {
	@ApiProperty({ example: "Base", description: "Budget name" })
	@IsString()
	@IsNotEmpty()
	@MaxLength(100)
	name!: string;

	@ApiPropertyOptional({ example: "#0d9488", description: "UI color hex/oklch" })
	@IsOptional()
	@IsString()
	color?: string;

	@ApiPropertyOptional({ example: "wallet", description: "Icon identifier" })
	@IsOptional()
	@IsString()
	icon?: string;

	@ApiProperty({
		enum: BudgetKind,
		example: BudgetKind.RECURRING,
		description: "RECURRING repeats every period; ONE_TIME covers a single date range",
	})
	@IsEnum(BudgetKind)
	kind!: BudgetKind;

	@ApiPropertyOptional({
		enum: BudgetPeriod,
		example: BudgetPeriod.MONTHLY,
		description: "Required for RECURRING, must be omitted for ONE_TIME",
	})
	@IsOptional()
	@IsEnum(BudgetPeriod)
	period?: BudgetPeriod;

	@ApiProperty({ example: "2026-01-01", description: "Budget start date (ISO 8601)" })
	@IsDateString()
	startDate!: string;

	@ApiPropertyOptional({
		example: "2026-12-31",
		description:
			"Required for ONE_TIME (must be after startDate). Optional for RECURRING (stops recurrence).",
	})
	@IsOptional()
	@IsDateString()
	endDate?: string;

	@ApiProperty({
		type: () => [BudgetItemInputDto],
		description: "Budget items, one per category (at least 1, no duplicate categories)",
	})
	@IsArray()
	@ArrayMinSize(1)
	@ValidateNested({ each: true })
	@Type(() => BudgetItemInputDto)
	items!: BudgetItemInputDto[];
}

export class UpdateBudgetDto {
	@ApiPropertyOptional({ example: "Base", description: "Budget name" })
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(100)
	name?: string;

	@ApiPropertyOptional({
		example: "#0d9488",
		nullable: true,
		description: "UI color hex/oklch. Pass null to clear.",
	})
	@IsOptional()
	@IsString()
	color?: string | null;

	@ApiPropertyOptional({
		example: "wallet",
		nullable: true,
		description: "Icon identifier. Pass null to clear.",
	})
	@IsOptional()
	@IsString()
	icon?: string | null;

	@ApiPropertyOptional({
		enum: BudgetKind,
		example: BudgetKind.RECURRING,
		description: "RECURRING or ONE_TIME",
	})
	@IsOptional()
	@IsEnum(BudgetKind)
	kind?: BudgetKind;

	@ApiPropertyOptional({
		enum: BudgetPeriod,
		example: BudgetPeriod.MONTHLY,
		nullable: true,
		description: "Required for RECURRING. Pass null to clear when switching to ONE_TIME.",
	})
	@IsOptional()
	@IsEnum(BudgetPeriod)
	period?: BudgetPeriod | null;

	@ApiPropertyOptional({ example: "2026-01-01", description: "Budget start date (ISO 8601)" })
	@IsOptional()
	@IsDateString()
	startDate?: string;

	@ApiPropertyOptional({
		example: "2026-12-31",
		nullable: true,
		description: "Required for ONE_TIME, optional for RECURRING. Pass null to clear.",
	})
	@IsOptional()
	@IsDateString()
	endDate?: string | null;

	@ApiPropertyOptional({ example: true, description: "Whether the budget is active" })
	@IsOptional()
	@IsBoolean()
	isActive?: boolean;

	@ApiPropertyOptional({
		type: () => [BudgetItemInputDto],
		description: "If provided, replaces ALL budget items",
	})
	@IsOptional()
	@IsArray()
	@ArrayMinSize(1)
	@ValidateNested({ each: true })
	@Type(() => BudgetItemInputDto)
	items?: BudgetItemInputDto[];
}

export class QueryBudgetsDto {
	@ApiPropertyOptional({
		example: "true",
		description: 'Filter by active state ("true"/"false"). Defaults to true.',
	})
	@IsOptional()
	@IsBooleanString()
	isActive?: string;

	@ApiPropertyOptional({
		enum: BudgetKind,
		example: BudgetKind.RECURRING,
		description: "Filter by budget kind",
	})
	@IsOptional()
	@IsEnum(BudgetKind)
	kind?: BudgetKind;

	@ApiPropertyOptional({
		enum: BudgetPeriod,
		example: BudgetPeriod.MONTHLY,
		description: "Filter by budget period",
	})
	@IsOptional()
	@IsEnum(BudgetPeriod)
	period?: BudgetPeriod;

	@ApiPropertyOptional({
		enum: BudgetSortBy,
		example: BudgetSortBy.startDate,
		default: BudgetSortBy.startDate,
		description: "Sort field",
	})
	@IsOptional()
	@IsEnum(BudgetSortBy)
	sortBy?: BudgetSortBy;

	@ApiPropertyOptional({
		enum: SortOrder,
		example: SortOrder.desc,
		default: SortOrder.desc,
		description: "Sort order",
	})
	@IsOptional()
	@IsEnum(SortOrder)
	order?: SortOrder;

	@ApiPropertyOptional({
		example: 1,
		default: 1,
		minimum: 1,
		description: "Page number (1-based)",
	})
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	page?: number;

	@ApiPropertyOptional({
		example: 10,
		default: 10,
		minimum: 1,
		maximum: 100,
		description: "Items per page",
	})
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	perPage?: number;

	@ApiPropertyOptional({
		example: "base",
		description: "Case-insensitive search by budget name (substring match)",
	})
	@IsOptional()
	@IsString()
	search?: string;
}

// ─── Response DTOs ─────────────────────────────────────────────────────

export class BudgetItemCategoryDto {
	@ApiProperty({ example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", description: "Category ID" })
	id!: string;

	@ApiProperty({ example: "Groceries", description: "Category name" })
	name!: string;

	@ApiProperty({ enum: CategoryType, example: CategoryType.EXPENSE, description: "Category type" })
	type!: CategoryType;
}

export class BudgetItemResponseDto {
	@ApiProperty({ example: "f1e2d3c4-b5a6-7890-abcd-ef1234567890", description: "Item ID" })
	id!: string;

	@ApiProperty({ example: "b1c2d3e4-f5a6-7890-abcd-ef1234567890", description: "Budget ID" })
	budgetId!: string;

	@ApiProperty({ example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", description: "Category ID" })
	categoryId!: string;

	@ApiProperty({ example: 5000, description: "Planned amount for this category" })
	amount!: number;

	@ApiProperty({ type: () => BudgetItemCategoryDto, description: "Item category" })
	category!: BudgetItemCategoryDto;

	@ApiProperty({ example: "2026-01-01T00:00:00.000Z", description: "Creation date" })
	createdAt!: Date;

	@ApiProperty({ example: "2026-01-01T00:00:00.000Z", description: "Last update date" })
	updatedAt!: Date;
}

export class BudgetResponseDto {
	@ApiProperty({ example: "b1c2d3e4-f5a6-7890-abcd-ef1234567890", description: "Budget ID" })
	id!: string;

	@ApiProperty({ example: "c1d2e3f4-a5b6-7890-abcd-ef1234567890", description: "Owner profile ID" })
	profileId!: string;

	@ApiProperty({ example: "Base", description: "Budget name" })
	name!: string;

	@ApiPropertyOptional({ example: "#0d9488", description: "UI color" })
	color!: string | null;

	@ApiPropertyOptional({ example: "wallet", description: "Icon identifier" })
	icon!: string | null;

	@ApiProperty({ enum: BudgetKind, example: BudgetKind.RECURRING, description: "Budget kind" })
	kind!: BudgetKind;

	@ApiProperty({
		enum: BudgetPeriod,
		example: BudgetPeriod.MONTHLY,
		nullable: true,
		description: "Budget period (null for ONE_TIME)",
	})
	period!: BudgetPeriod | null;

	@ApiProperty({ example: "2026-01-01T00:00:00.000Z", description: "Start date" })
	startDate!: Date;

	@ApiProperty({ example: null, nullable: true, description: "End date" })
	endDate!: Date | null;

	@ApiProperty({ example: true, description: "Whether the budget is active" })
	isActive!: boolean;

	@ApiProperty({ type: () => [BudgetItemResponseDto], description: "Budget items" })
	items!: BudgetItemResponseDto[];

	@ApiProperty({ example: "2026-01-01T00:00:00.000Z", description: "Creation date" })
	createdAt!: Date;

	@ApiProperty({ example: "2026-01-01T00:00:00.000Z", description: "Last update date" })
	updatedAt!: Date;
}

export class BudgetListItemDto extends BudgetResponseDto {
	@ApiProperty({
		example: 1000,
		description: "Planned total of the budget's EXPENSE items (INCOME items are ignored)",
	})
	totalExpenses!: number;

	@ApiProperty({
		example: 800,
		description:
			"Actual spent in the budget's current period across its EXPENSE item categories (includes installments)",
	})
	periodExpenses!: number;

	@ApiProperty({
		example: 80,
		description:
			"round(periodExpenses / totalExpenses * 100); can exceed 100; 0 when totalExpenses is 0",
	})
	percentage!: number;
}

export class BudgetsInfoDto {
	@ApiProperty({
		example: 3200,
		description: "Planned amount of EXPENSE items, summed across all filtered budgets",
	})
	totalExpenses!: number;

	@ApiProperty({
		example: 15000,
		description: "Planned amount of INCOME items, summed across all filtered budgets",
	})
	totalIncomes!: number;
}

export class BudgetsListResponseDto {
	@ApiProperty({
		type: () => [BudgetListItemDto],
		description: "Budgets in the current page, with current-period expense progress",
	})
	budgets!: BudgetListItemDto[];

	@ApiProperty({
		type: () => BudgetsInfoDto,
		description: "Planned income/expense totals across all filtered budgets (not just this page)",
	})
	info!: BudgetsInfoDto;

	@ApiProperty({ example: 1, description: "Current page number" })
	page!: number;

	@ApiProperty({ example: 10, description: "Items per page" })
	perPage!: number;

	@ApiProperty({ example: 1, description: "Total matching items across all pages" })
	total!: number;

	@ApiProperty({ example: 1, description: "Total pages (ceil(total / perPage))" })
	totalPages!: number;
}

export class BudgetItemProgressDto {
	@ApiProperty({ example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", description: "Category ID" })
	categoryId!: string;

	@ApiProperty({ example: "Groceries", description: "Category name" })
	categoryName!: string;

	@ApiProperty({ enum: CategoryType, example: CategoryType.EXPENSE, description: "Category type" })
	categoryType!: CategoryType;

	@ApiProperty({ example: 5000, description: "Planned amount" })
	plannedAmount!: number;

	@ApiProperty({ example: 3200, description: "Spent (EXPENSE) or received (INCOME) in period" })
	spentAmount!: number;

	@ApiProperty({ example: 1800, description: "Planned minus spent (negative when exceeded)" })
	remaining!: number;

	@ApiProperty({ example: 64, description: "Percentage used, rounded (can exceed 100)" })
	percentage!: number;
}

export class BudgetProgressDto {
	@ApiProperty({ example: "b1c2d3e4-f5a6-7890-abcd-ef1234567890", description: "Budget ID" })
	id!: string;

	@ApiProperty({ example: "Base", description: "Budget name" })
	name!: string;

	@ApiPropertyOptional({ example: "#0d9488", description: "UI color" })
	color!: string | null;

	@ApiPropertyOptional({ example: "wallet", description: "Icon identifier" })
	icon!: string | null;

	@ApiProperty({ enum: BudgetKind, example: BudgetKind.RECURRING, description: "Budget kind" })
	kind!: BudgetKind;

	@ApiProperty({
		enum: BudgetPeriod,
		example: BudgetPeriod.MONTHLY,
		nullable: true,
		description: "Budget period (null for ONE_TIME)",
	})
	period!: BudgetPeriod | null;

	@ApiProperty({ example: "2026-10-01T00:00:00.000Z", description: "Current period start" })
	periodStart!: Date;

	@ApiProperty({ example: "2026-10-31T23:59:59.999Z", description: "Current period end" })
	periodEnd!: Date;

	@ApiProperty({ example: 5000, description: "Total planned across all items" })
	totalPlanned!: number;

	@ApiProperty({ example: 3200, description: "Total spent across all items" })
	totalSpent!: number;

	@ApiProperty({ example: 1800, description: "Total remaining" })
	totalRemaining!: number;

	@ApiProperty({ example: 64, description: "Total percentage used, rounded" })
	totalPercentage!: number;

	@ApiProperty({ type: () => [BudgetItemProgressDto], description: "Per-item progress" })
	items!: BudgetItemProgressDto[];
}

export class BudgetHistoryItemDto {
	@ApiProperty({ example: "f1e2d3c4-b5a6-7890-abcd-ef1234567890", description: "Budget item ID" })
	budgetItemId!: string;

	@ApiProperty({ example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", description: "Category ID" })
	categoryId!: string;

	@ApiProperty({ example: 5000, description: "Planned amount for the period" })
	plannedAmount!: number;

	@ApiProperty({ example: 3200, description: "Spent amount for the period" })
	spentAmount!: number;
}

export class BudgetHistoryDto {
	@ApiProperty({ example: "d1e2f3a4-b5c6-7890-abcd-ef1234567890", description: "Snapshot ID" })
	id!: string;

	@ApiProperty({ example: "2026-09-01T00:00:00.000Z", description: "Period start" })
	periodStart!: Date;

	@ApiProperty({ example: "2026-09-30T23:59:59.999Z", description: "Period end" })
	periodEnd!: Date;

	@ApiProperty({ example: 5000, description: "Total planned for the period" })
	totalPlanned!: number;

	@ApiProperty({ example: 3200, description: "Total spent for the period" })
	totalSpent!: number;

	@ApiProperty({ type: () => [BudgetHistoryItemDto], description: "Per-item snapshot" })
	items!: BudgetHistoryItemDto[];

	@ApiProperty({ example: "2026-10-01T00:00:00.000Z", description: "Snapshot creation date" })
	createdAt!: Date;
}
