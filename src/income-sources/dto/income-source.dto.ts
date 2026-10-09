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
	MaxLength,
	Min,
} from "class-validator";

enum IncomeFrequency {
	WEEKLY = "WEEKLY",
	BIWEEKLY = "BIWEEKLY",
	MONTHLY = "MONTHLY",
}

enum IncomeSourceSortBy {
	name = "name",
	amount = "amount",
	createdAt = "createdAt",
}

enum SortOrder {
	asc = "asc",
	desc = "desc",
}

export class CreateIncomeSourceDto {
	@ApiProperty({ example: "Trabajo principal", description: "Income source display name" })
	@IsString()
	@IsNotEmpty()
	@MaxLength(100)
	name!: string;

	@ApiProperty({ example: 25000, description: "Amount received per payment cycle" })
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	amount!: number;

	@ApiProperty({
		enum: IncomeFrequency,
		example: "MONTHLY",
		description: "Payment frequency",
	})
	@IsEnum(IncomeFrequency)
	frequency!: IncomeFrequency;

	@ApiProperty({
		example: [15],
		description:
			"Payment days. WEEKLY: 1 weekday (1-7). BIWEEKLY: 2 days of month (1-31). MONTHLY: 1 day of month (1-31).",
	})
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(2)
	@IsInt({ each: true })
	paydays!: number[];

	@ApiProperty({
		example: "account-uuid",
		description: "Destination account ID where income balance lands (must be DEBIT or CASH)",
	})
	@IsString()
	@IsNotEmpty()
	destinationAccountId!: string;
}

export class UpdateIncomeSourceDto {
	@ApiPropertyOptional({ example: "Trabajo principal", description: "Income source display name" })
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(100)
	name?: string;

	@ApiPropertyOptional({ example: 25000, description: "Amount received per payment cycle" })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	amount?: number;

	@ApiPropertyOptional({
		enum: IncomeFrequency,
		example: "MONTHLY",
		description: "Payment frequency",
	})
	@IsOptional()
	@IsEnum(IncomeFrequency)
	frequency?: IncomeFrequency;

	@ApiPropertyOptional({
		example: [15],
		description:
			"Payment days. WEEKLY: 1 weekday (1-7). BIWEEKLY: 2 days of month (1-31). MONTHLY: 1 day of month (1-31).",
	})
	@IsOptional()
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(2)
	@IsInt({ each: true })
	paydays?: number[];

	@ApiPropertyOptional({
		example: "account-uuid",
		description: "Destination account ID where income balance lands (must be DEBIT or CASH)",
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	destinationAccountId?: string;
}

export class IncomeSourceResponseDto {
	@ApiProperty({ example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", description: "Income source ID" })
	id!: string;

	@ApiProperty({ example: "profile-uuid", description: "Owner profile ID" })
	profileId!: string;

	@ApiProperty({ example: "Trabajo principal", description: "Income source display name" })
	name!: string;

	@ApiProperty({ example: 25000, description: "Amount received per payment cycle" })
	amount!: number;

	@ApiProperty({ enum: IncomeFrequency, example: "MONTHLY", description: "Payment frequency" })
	frequency!: IncomeFrequency;

	@ApiProperty({
		example: [15],
		description:
			"Payment days. WEEKLY: 1 weekday (1-7). BIWEEKLY: 2 days of month (1-31). MONTHLY: 1 day of month (1-31).",
	})
	paydays!: number[];

	@ApiProperty({
		example: "account-uuid",
		description: "Destination account ID where income balance lands",
	})
	destinationAccountId!: string;

	@ApiProperty({ example: true, description: "Whether the income source is active" })
	isActive!: boolean;

	@ApiProperty({ example: "2026-07-27T05:14:40.000Z", description: "Creation date" })
	createdAt!: Date;

	@ApiProperty({ example: "2026-07-27T05:14:40.000Z", description: "Last update date" })
	updatedAt!: Date;
}

// ─── Bulk Create DTO ─────────────────────────────────────────────────

export class BulkCreateIncomeSourcesDto {
	@ApiProperty({
		type: [CreateIncomeSourceDto],
		example: [
			{
				name: "Trabajo principal",
				amount: 25000,
				frequency: "MONTHLY",
				paydays: [15],
				destinationAccountId: "acct-uuid-1",
			},
			{
				name: "Freelance",
				amount: 5000,
				frequency: "WEEKLY",
				paydays: [5],
				destinationAccountId: "acct-uuid-1",
			},
		],
		description: "Array of income sources to create (1-10 items)",
	})
	// Typed as unknown[] (no @ValidateNested/@Type) on purpose: nested transformation under the
	// global ValidationPipe with enableImplicitConversion corrupts items into empty arrays.
	// Items are validated per-item in the service via plainToInstance + validate.
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(10)
	sources!: unknown[];
}

export class FailedIncomeSourceDto {
	@ApiProperty({
		example: {
			name: "Trabajo principal",
			amount: -100,
			frequency: "MONTHLY",
			paydays: [15],
			destinationAccountId: "acct-uuid-1",
		},
		description: "The original input that failed validation",
	})
	input!: Record<string, unknown>;

	@ApiProperty({
		example: ["amount must not be less than 0"],
		description: "Validation error messages for this item",
		type: [String],
	})
	errors!: string[];
}

export class BulkCreateResponseDto {
	@ApiProperty({ enum: ["success", "partial", "failed"], example: "partial" })
	creationState!: "success" | "partial" | "failed";

	@ApiProperty({ example: 1, description: "Total number of items received" })
	total!: number;

	@ApiProperty({
		type: [IncomeSourceResponseDto],
		description: "Successfully created income sources",
	})
	successful!: IncomeSourceResponseDto[];

	@ApiProperty({
		type: [FailedIncomeSourceDto],
		description: "Items that failed validation",
	})
	failed!: FailedIncomeSourceDto[];
}

export class QueryIncomeSourcesDto {
	@ApiPropertyOptional({
		example: "true",
		description: 'Filter by active state (accepts "true"/"false"). Defaults to true.',
	})
	@IsOptional()
	@IsBooleanString()
	isActive?: string;

	@ApiPropertyOptional({
		enum: IncomeSourceSortBy,
		example: "createdAt",
		default: "createdAt",
		description: "Sort field",
	})
	@IsOptional()
	@IsEnum(IncomeSourceSortBy)
	sortBy?: IncomeSourceSortBy;

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
