import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
	IsBooleanString,
	IsEnum,
	IsNotEmpty,
	IsOptional,
	IsString,
	MaxLength,
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

export interface BankKpis {
	netWorth: number;
	liquidity: number;
	debt: number;
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
		type: BankInfoDto,
		description: "Financial KPIs (only present when ?info=true)",
	})
	info?: BankInfoDto;
}

export class QueryBanksDto {
	@ApiPropertyOptional({
		example: "true",
		description: 'Filter by active state (accepts "true"/"false"). Defaults to true.',
	})
	@IsOptional()
	@IsBooleanString()
	isActive?: string;

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
		example: "true",
		description:
			'Include financial KPIs (liquidity, debt) per bank. Accepts "true"/"false". Defaults to false.',
	})
	@IsOptional()
	@IsBooleanString()
	info?: string;
}
