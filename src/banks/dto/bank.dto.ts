import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
	IsBooleanString,
	IsEnum,
	IsInt,
	IsNotEmpty,
	IsOptional,
	IsString,
	Max,
	MaxLength,
	Min,
} from "class-validator";

enum BankSortBy {
	name = "name",
	createdAt = "createdAt",
}

enum SortOrder {
	asc = "asc",
	desc = "desc",
}

// ─── KPI types ────────────────────────────────────────────────────────

/** Global KPIs for the banks list (no breakdown). */
export interface BankKpis {
	netWorth: number;
	liquidity: number;
	debt: number;
}

/** Detail KPIs for a single bank (includes breakdown). */
export interface BankDetailKpis extends BankKpis {
	balanceBreakdown: { assets: number; liabilities: number };
}

export class BalanceBreakdownDto {
	@ApiProperty({
		example: 18000000,
		description: "Total assets in integer cents (positive balances across all accounts)",
	})
	assets!: number;

	@ApiProperty({
		example: 5500000,
		description: "Total liabilities in integer cents (negative balances + loan remaining)",
	})
	liabilities!: number;
}

/** Info block for the banks list endpoint (global summary). */
export class BankInfoDto {
	@ApiProperty({
		example: 12500000,
		description: "Net worth in integer cents (assets - liabilities)",
	})
	netWorth!: number;

	@ApiProperty({
		example: 8000000,
		description: "Liquidity in integer cents (DEBIT + CASH accounts with positive balance)",
	})
	liquidity!: number;

	@ApiProperty({
		example: 5500000,
		description: "Total debt in integer cents (credit utilized + loan remaining)",
	})
	debt!: number;
}

/** Info block for the single bank detail endpoint (includes balance breakdown). */
export class BankDetailInfoDto extends BankInfoDto {
	@ApiProperty({ type: BalanceBreakdownDto, description: "Balance breakdown in cents" })
	balanceBreakdown!: BalanceBreakdownDto;
}

export class CreateBankDto {
	@ApiProperty({ example: "BBVA", description: "Bank display name" })
	@IsString()
	@IsNotEmpty()
	@MaxLength(100)
	name!: string;

	@ApiPropertyOptional({ example: "#0d9488", description: "UI color hex/oklch", required: false })
	@IsOptional()
	@IsString()
	color?: string;

	@ApiPropertyOptional({
		example: "bbva-logo",
		description: "Logo identifier or URL",
		required: false,
	})
	@IsOptional()
	@IsString()
	logo?: string;
}

export class UpdateBankDto {
	@ApiPropertyOptional({ example: "BBVA", description: "Bank display name", required: false })
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(100)
	name?: string;

	@ApiPropertyOptional({ example: "#0d9488", description: "UI color hex/oklch", required: false })
	@IsOptional()
	@IsString()
	color?: string;

	@ApiPropertyOptional({
		example: "bbva-logo",
		description: "Logo identifier or URL",
		required: false,
	})
	@IsOptional()
	@IsString()
	logo?: string;
}

export class BankResponseDto {
	@ApiProperty({ example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", description: "Bank ID" })
	id!: string;

	@ApiProperty({ example: "profile-uuid", description: "Owner profile ID" })
	profileId!: string;

	@ApiProperty({ example: "BBVA", description: "Bank display name" })
	name!: string;

	@ApiPropertyOptional({ example: "#0d9488", description: "UI color" })
	color!: string | null;

	@ApiPropertyOptional({ example: "bbva-logo", description: "Logo identifier or URL" })
	logo!: string | null;

	@ApiProperty({ example: true, description: "Whether the bank is active" })
	isActive!: boolean;

	@ApiProperty({ example: "2026-07-28T07:06:12.000Z", description: "Creation date" })
	createdAt!: Date;

	@ApiProperty({ example: "2026-07-28T07:06:12.000Z", description: "Last update date" })
	updatedAt!: Date;

	@ApiPropertyOptional({
		type: BankDetailInfoDto,
		description: "Financial KPIs with balance breakdown (only present when ?info=true)",
	})
	info?: BankDetailInfoDto;
}

// ─── Paginated list response DTOs ────────────────────────────────────

export class BanksListDataDto {
	@ApiProperty({ type: [BankResponseDto], description: "List of banks for the current page" })
	banks!: BankResponseDto[];

	@ApiPropertyOptional({
		type: BankInfoDto,
		description: "Financial summary (only when info=true)",
	})
	info?: BankInfoDto;

	@ApiProperty({ example: 1, description: "Current page number" })
	page!: number;

	@ApiProperty({ example: 10, description: "Items per page" })
	perPage!: number;

	@ApiProperty({ example: 1, description: "Total matching items across all pages" })
	total!: number;

	@ApiProperty({ example: 1, description: "Total pages (ceil(total / perPage))" })
	totalPages!: number;
}

// ─── Query DTO ───────────────────────────────────────────────────────

export class QueryBanksDto {
	@ApiPropertyOptional({
		example: "true",
		description: 'Filter by active state (accepts "true"/"false"). Defaults to true.',
	})
	@IsOptional()
	@IsBooleanString()
	isActive?: string;

	@ApiPropertyOptional({
		example: "BBVA",
		description: "Case-insensitive search by bank name (substring match)",
	})
	@IsOptional()
	@IsString()
	search?: string;

	@ApiPropertyOptional({
		enum: BankSortBy,
		example: "name",
		default: "name",
		description: "Sort field",
	})
	@IsOptional()
	@IsEnum(BankSortBy)
	sortBy?: BankSortBy;

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
		example: "true",
		description:
			'Include financial KPIs (liquidity, debt) per bank. Accepts "true"/"false". Defaults to false.',
	})
	@IsOptional()
	@IsBooleanString()
	info?: string;
}
