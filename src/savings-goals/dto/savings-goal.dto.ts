import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
	IsBooleanString,
	IsDateString,
	IsEnum,
	IsInt,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	Max,
	MaxLength,
	Min,
} from "class-validator";

enum SavingsGoalSortBy {
	deadline = "deadline",
	targetAmount = "targetAmount",
	currentAmount = "currentAmount",
}

enum SortOrder {
	asc = "asc",
	desc = "desc",
}

export class CreateSavingsGoalDto {
	@ApiProperty({
		example: "account-uuid",
		description: "Account ID where the savings money lives (DEBIT or CASH)",
	})
	@IsString()
	@IsNotEmpty()
	accountId!: string;

	@ApiProperty({ example: "Viaje a Europa", description: "Savings goal display name" })
	@IsString()
	@IsNotEmpty()
	@MaxLength(100)
	name!: string;

	@ApiProperty({ example: 50000, description: "Target amount to save" })
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	targetAmount!: number;

	@ApiPropertyOptional({ example: "2026-12-31T00:00:00.000Z", description: "Optional deadline" })
	@IsOptional()
	@IsDateString()
	deadline?: string;

	@ApiPropertyOptional({ example: "#22c55e", description: "UI color hex/oklch" })
	@IsOptional()
	@IsString()
	color?: string;

	@ApiPropertyOptional({ example: "plane", description: "Icon identifier" })
	@IsOptional()
	@IsString()
	icon?: string;
}

export class UpdateSavingsGoalDto {
	@ApiPropertyOptional({
		example: "account-uuid",
		description: "Account ID where the savings money lives",
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	accountId?: string;

	@ApiPropertyOptional({ example: "Viaje a Europa", description: "Savings goal display name" })
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(100)
	name?: string;

	@ApiPropertyOptional({ example: 50000, description: "Target amount to save" })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	targetAmount?: number;

	@ApiPropertyOptional({ example: "2026-12-31T00:00:00.000Z", description: "Optional deadline" })
	@IsOptional()
	@IsDateString()
	deadline?: string;

	@ApiPropertyOptional({ example: "#22c55e", description: "UI color hex/oklch" })
	@IsOptional()
	@IsString()
	color?: string;

	@ApiPropertyOptional({
		example: "plane",
		nullable: true,
		description: "Icon identifier. Pass null to clear.",
	})
	@IsOptional()
	@IsString()
	icon?: string | null;
}

export class SavingsGoalResponseDto {
	@ApiProperty({ example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", description: "Savings goal ID" })
	id!: string;

	@ApiProperty({ example: "profile-uuid", description: "Owner profile ID" })
	profileId!: string;

	@ApiProperty({ example: "account-uuid", description: "Account ID where the savings money lives" })
	accountId!: string;

	@ApiProperty({ example: "Viaje a Europa", description: "Savings goal display name" })
	name!: string;

	@ApiProperty({ example: 50000, description: "Target amount to save" })
	targetAmount!: number;

	@ApiPropertyOptional({ example: "2026-12-31T00:00:00.000Z", description: "Optional deadline" })
	deadline!: Date | null;

	@ApiPropertyOptional({ example: "#22c55e", description: "UI color" })
	color!: string | null;

	@ApiPropertyOptional({ example: "plane", description: "Icon identifier" })
	icon!: string | null;

	@ApiProperty({
		example: 12500,
		description: "Current amount saved (computed from account balance)",
	})
	currentAmount!: number;

	@ApiProperty({
		example: false,
		description: "Whether the goal is completed (computed: currentAmount >= targetAmount)",
	})
	isCompleted!: boolean;

	@ApiProperty({ example: "2026-07-28T20:31:08.000Z", description: "Creation date" })
	createdAt!: Date;

	@ApiProperty({ example: "2026-07-28T20:31:08.000Z", description: "Last update date" })
	updatedAt!: Date;
}

export class QuerySavingsGoalsDto {
	@ApiPropertyOptional({
		example: "false",
		description:
			'Filter by completed state (accepts "true"/"false"). Computed from account balance vs target.',
	})
	@IsOptional()
	@IsBooleanString()
	isCompleted?: string;

	@ApiPropertyOptional({
		enum: SavingsGoalSortBy,
		example: "deadline",
		default: "deadline",
		description: "Sort field. currentAmount is computed and sorted in memory.",
	})
	@IsOptional()
	@IsEnum(SavingsGoalSortBy)
	sortBy?: SavingsGoalSortBy;

	@ApiPropertyOptional({
		enum: SortOrder,
		example: "asc",
		default: "asc",
		description: "Sort order",
	})
	@IsOptional()
	@IsEnum(SortOrder)
	order?: SortOrder;

	@ApiPropertyOptional({
		example: "viaje",
		description: "Case-insensitive search by savings goal name (substring match)",
	})
	@IsOptional()
	@IsString()
	search?: string;

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
}

// ─── Paginated list response DTOs ──────────────────────────────────────

export class SavingsGoalsInfoDto {
	@ApiProperty({
		example: 5,
		description: "Number of savings goals matching the active filters",
	})
	totalSavingsGoals!: number;

	@ApiProperty({
		example: 12500,
		description: "Sum of currentAmount (account balance) across all filtered goals",
	})
	totalSaved!: number;
}

export class SavingsGoalsListResponseDto {
	@ApiProperty({
		type: () => [SavingsGoalResponseDto],
		description: "Savings goals in the current page, with computed progress",
	})
	savingsGoals!: SavingsGoalResponseDto[];

	@ApiProperty({
		type: () => SavingsGoalsInfoDto,
		description: "Totals across all filtered savings goals (not just this page)",
	})
	info!: SavingsGoalsInfoDto;

	@ApiProperty({ example: 1, description: "Current page number" })
	page!: number;

	@ApiProperty({ example: 10, description: "Items per page" })
	perPage!: number;

	@ApiProperty({ example: 1, description: "Total matching items across all pages" })
	total!: number;

	@ApiProperty({ example: 1, description: "Total pages (ceil(total / perPage))" })
	totalPages!: number;
}
