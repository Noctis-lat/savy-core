import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
	ArrayMaxSize,
	ArrayMinSize,
	IsArray,
	IsBooleanString,
	IsEnum,
	IsInt,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	IsUrl,
	Max,
	MaxLength,
	Min,
} from "class-validator";

enum RecurringExpenseType {
	SUBSCRIPTION = "SUBSCRIPTION",
	SERVICE = "SERVICE",
	UNCLASSIFIED = "UNCLASSIFIED",
}

enum RecurringExpenseFrequency {
	WEEKLY = "WEEKLY",
	BIWEEKLY = "BIWEEKLY",
	MONTHLY = "MONTHLY",
	YEARLY = "YEARLY",
}

enum RecurringExpenseSortBy {
	name = "name",
	amount = "amount",
	createdAt = "createdAt",
}

enum SortOrder {
	asc = "asc",
	desc = "desc",
}

export class CreateRecurringExpenseDto {
	@ApiProperty({ example: "Netflix", description: "Recurring expense display name" })
	@IsString()
	@IsNotEmpty()
	@MaxLength(100)
	name!: string;

	@ApiProperty({ example: 199.0, description: "Amount charged per billing cycle" })
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	amount!: number;

	@ApiProperty({
		enum: RecurringExpenseFrequency,
		example: "MONTHLY",
		description: "Billing frequency",
	})
	@IsEnum(RecurringExpenseFrequency)
	frequency!: RecurringExpenseFrequency;

	@ApiProperty({
		example: [15],
		description:
			"Billing days. WEEKLY: 1 weekday (1-7). BIWEEKLY: 2 days of month (1-31). MONTHLY: 1 day of month (1-31). YEARLY: 1 day of month (1-31).",
	})
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(2)
	@IsInt({ each: true })
	@Min(1, { each: true })
	@Max(31, { each: true })
	billingDays!: number[];

	@ApiPropertyOptional({
		enum: RecurringExpenseType,
		example: "SUBSCRIPTION",
		default: "UNCLASSIFIED",
		description: "Type of recurring expense",
	})
	@IsOptional()
	@IsEnum(RecurringExpenseType)
	type?: RecurringExpenseType;

	@ApiProperty({
		example: "account-uuid",
		description: "Account ID where the expense is charged (payment method)",
	})
	@IsString()
	@IsNotEmpty()
	accountId!: string;

	@ApiPropertyOptional({
		example: "category-uuid",
		description: "Category ID for classifying the generated expense transaction",
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	categoryId?: string;

	@ApiPropertyOptional({
		example: "https://www.netflix.com",
		description: "URL of the service or subscription (optional, for management)",
	})
	@IsOptional()
	@IsString()
	@IsUrl()
	url?: string;

	@ApiPropertyOptional({ example: "#e50914", description: "UI color hex/oklch" })
	@IsOptional()
	@IsString()
	color?: string;

	@ApiPropertyOptional({ example: "play", description: "Icon identifier" })
	@IsOptional()
	@IsString()
	icon?: string;
}

export class UpdateRecurringExpenseDto {
	@ApiPropertyOptional({
		example: "Netflix Premium",
		description: "Recurring expense display name",
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(100)
	name?: string;

	@ApiPropertyOptional({ example: 299.0, description: "Amount charged per billing cycle" })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	amount?: number;

	@ApiPropertyOptional({
		enum: RecurringExpenseFrequency,
		example: "MONTHLY",
		description: "Billing frequency",
	})
	@IsOptional()
	@IsEnum(RecurringExpenseFrequency)
	frequency?: RecurringExpenseFrequency;

	@ApiPropertyOptional({
		example: [15],
		description:
			"Billing days. WEEKLY: 1 weekday (1-7). BIWEEKLY: 2 days of month (1-31). MONTHLY: 1 day of month (1-31). YEARLY: 1 day of month (1-31).",
	})
	@IsOptional()
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(2)
	@IsInt({ each: true })
	@Min(1, { each: true })
	@Max(31, { each: true })
	billingDays?: number[];

	@ApiPropertyOptional({
		enum: RecurringExpenseType,
		example: "SUBSCRIPTION",
		description: "Type of recurring expense",
	})
	@IsOptional()
	@IsEnum(RecurringExpenseType)
	type?: RecurringExpenseType;

	@ApiPropertyOptional({
		example: "account-uuid",
		description: "Account ID where the expense is charged (payment method)",
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	accountId?: string;

	@ApiPropertyOptional({
		example: "category-uuid",
		description: "Category ID for classifying the generated expense transaction",
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	categoryId?: string;

	@ApiPropertyOptional({
		example: "https://www.netflix.com",
		description: "URL of the service or subscription (optional, for management)",
	})
	@IsOptional()
	@IsString()
	@IsUrl()
	url?: string;

	@ApiPropertyOptional({ example: "#e50914", description: "UI color hex/oklch" })
	@IsOptional()
	@IsString()
	color?: string;

	@ApiPropertyOptional({ example: "play", description: "Icon identifier" })
	@IsOptional()
	@IsString()
	icon?: string;
}

export class RecurringExpenseResponseDto {
	@ApiProperty({
		example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		description: "Recurring expense ID",
	})
	id!: string;

	@ApiProperty({ example: "profile-uuid", description: "Owner profile ID" })
	profileId!: string;

	@ApiProperty({ example: "Netflix", description: "Recurring expense display name" })
	name!: string;

	@ApiProperty({ example: 199.0, description: "Amount charged per billing cycle" })
	amount!: number;

	@ApiProperty({
		enum: RecurringExpenseFrequency,
		example: "MONTHLY",
		description: "Billing frequency",
	})
	frequency!: RecurringExpenseFrequency;

	@ApiProperty({
		example: [15],
		description:
			"Billing days. WEEKLY: 1 weekday (1-7). BIWEEKLY: 2 days of month (1-31). MONTHLY: 1 day of month (1-31). YEARLY: 1 day of month (1-31).",
	})
	billingDays!: number[];

	@ApiProperty({
		enum: RecurringExpenseType,
		example: "SUBSCRIPTION",
		description: "Type of recurring expense",
	})
	type!: RecurringExpenseType;

	@ApiProperty({
		example: "account-uuid",
		description: "Account ID where the expense is charged",
	})
	accountId!: string;

	@ApiPropertyOptional({
		example: "category-uuid",
		description: "Category ID for classifying the generated expense transaction",
	})
	categoryId!: string | null;

	@ApiPropertyOptional({
		example: "https://www.netflix.com",
		description: "URL of the service or subscription",
	})
	url!: string | null;

	@ApiPropertyOptional({ example: "#e50914", description: "UI color" })
	color!: string | null;

	@ApiPropertyOptional({ example: "play", description: "Icon identifier" })
	icon!: string | null;

	@ApiProperty({ example: true, description: "Whether the recurring expense is active" })
	isActive!: boolean;

	@ApiProperty({ example: "2026-10-02T18:32:59.000Z", description: "Creation date" })
	createdAt!: Date;

	@ApiProperty({ example: "2026-10-02T18:32:59.000Z", description: "Last update date" })
	updatedAt!: Date;
}

export class QueryRecurringExpensesDto {
	@ApiPropertyOptional({
		enum: RecurringExpenseType,
		example: "SUBSCRIPTION",
		description: "Filter by recurring expense type",
	})
	@IsOptional()
	@IsEnum(RecurringExpenseType)
	type?: RecurringExpenseType;

	@ApiPropertyOptional({
		example: "true",
		description: 'Filter by active state (accepts "true"/"false"). Defaults to true.',
	})
	@IsOptional()
	@IsBooleanString()
	isActive?: string;

	@ApiPropertyOptional({
		enum: RecurringExpenseSortBy,
		example: "createdAt",
		default: "createdAt",
		description: "Sort field",
	})
	@IsOptional()
	@IsEnum(RecurringExpenseSortBy)
	sortBy?: RecurringExpenseSortBy;

	@ApiPropertyOptional({
		enum: SortOrder,
		example: "desc",
		default: "desc",
		description: "Sort order",
	})
	@IsOptional()
	@IsEnum(SortOrder)
	order?: SortOrder;
}
