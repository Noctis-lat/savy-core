import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
	IsBooleanString,
	IsEnum,
	IsInt,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	Max,
	Min,
} from "class-validator";

enum AccountType {
	DEBIT = "DEBIT",
	CREDIT = "CREDIT",
	LOAN = "LOAN",
	CASH = "CASH",
}

enum AccountSortBy {
	balance = "balance",
	name = "name",
	createdAt = "createdAt",
}

enum SortOrder {
	asc = "asc",
	desc = "desc",
}

enum GroupBy {
	banks = "banks",
	types = "types",
}

export class CreateAccountDto {
	@ApiProperty({ example: "Checking Account", description: "Account display name" })
	@IsString()
	@IsNotEmpty()
	name!: string;

	@ApiProperty({ enum: AccountType, example: "DEBIT", description: "Account type" })
	@IsEnum(AccountType)
	type!: AccountType;

	@ApiPropertyOptional({
		example: "bank-uuid",
		description: "Bank ID (null for CASH accounts)",
	})
	@IsOptional()
	@IsString()
	bankId?: string | null;

	@ApiPropertyOptional({ example: "MXN", description: "ISO currency code" })
	@IsOptional()
	@IsString()
	currency?: string;

	@ApiPropertyOptional({ example: 5000.0, description: "Initial balance" })
	@IsOptional()
	@IsNumber()
	balance?: number;

	@ApiPropertyOptional({ example: "#0d9488", description: "UI color hex/oklch" })
	@IsOptional()
	@IsString()
	color?: string;

	@ApiPropertyOptional({ example: "wallet", description: "Icon identifier" })
	@IsOptional()
	@IsString()
	icon?: string;
}

export class UpdateAccountDto {
	@ApiPropertyOptional({ example: "Checking Account", description: "Account display name" })
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	name?: string;

	@ApiPropertyOptional({ example: "bank-uuid", description: "Bank ID (null for CASH accounts)" })
	@IsOptional()
	@IsString()
	bankId?: string | null;

	@ApiPropertyOptional({ example: "MXN", description: "ISO currency code" })
	@IsOptional()
	@IsString()
	currency?: string;

	@ApiPropertyOptional({ example: 5000.0, description: "Current balance" })
	@IsOptional()
	@IsNumber()
	balance?: number;

	@ApiPropertyOptional({ example: "#0d9488", description: "UI color hex/oklch" })
	@IsOptional()
	@IsString()
	color?: string;

	@ApiPropertyOptional({ example: "wallet", description: "Icon identifier" })
	@IsOptional()
	@IsString()
	icon?: string;
}

export class AccountResponseDto {
	@ApiProperty({ example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", description: "Account ID" })
	id!: string;

	@ApiProperty({ example: "profile-uuid", description: "Owner profile ID" })
	profileId!: string;

	@ApiPropertyOptional({ example: "bank-uuid", description: "Bank ID (null for CASH)" })
	bankId!: string | null;

	@ApiProperty({ example: "Checking Account", description: "Account display name" })
	name!: string;

	@ApiProperty({ enum: AccountType, example: "DEBIT", description: "Account type" })
	type!: AccountType;

	@ApiProperty({ example: "MXN", description: "ISO currency code" })
	currency!: string;

	@ApiProperty({ example: 5000.0, description: "Current balance" })
	balance!: number;

	@ApiPropertyOptional({ example: "#0d9488", description: "UI color" })
	color!: string | null;

	@ApiPropertyOptional({ example: "wallet", description: "Icon identifier" })
	icon!: string | null;

	@ApiProperty({ example: true, description: "Whether the account is active" })
	isActive!: boolean;

	@ApiProperty({ example: "2026-07-28T07:06:12.000Z", description: "Creation date" })
	createdAt!: Date;

	@ApiProperty({ example: "2026-07-28T07:06:12.000Z", description: "Last update date" })
	updatedAt!: Date;
}

// ─── Financial info DTOs ─────────────────────────────────────────────

export class AccountsInfoDto {
	@ApiProperty({ example: 12500000, description: "Net worth (assets - liabilities)" })
	netWorth!: number;

	@ApiProperty({ example: 8000000, description: "Liquidity (DEBIT + CASH balances)" })
	liquidity!: number;

	@ApiProperty({ example: 5500000, description: "Debt (CREDIT + LOAN balances, positive value)" })
	debt!: number;
}

// ─── Grouped accounts DTOs ───────────────────────────────────────────

export class AccountGroupDto {
	@ApiProperty({
		example: "DEBIT",
		description:
			"Stable identifier (AccountType value or bankId, 'none' for accounts without a bank)",
	})
	key!: string;

	@ApiProperty({
		example: "DEBIT",
		description:
			"Display label (AccountType value or bank name, 'No bank' for accounts without a bank)",
	})
	title!: string;

	@ApiProperty({ type: [AccountResponseDto], description: "Accounts in this group" })
	accounts!: AccountResponseDto[];
}

// ─── Paginated list response DTOs ────────────────────────────────────

export class AccountsListDataDto {
	@ApiPropertyOptional({
		type: [AccountResponseDto],
		description: "Flat list of accounts (omitted when groupedBy is set)",
	})
	accounts?: AccountResponseDto[];

	@ApiPropertyOptional({
		type: [AccountGroupDto],
		description: "Accounts grouped by bank or type (only when groupedBy is set)",
	})
	groupedAccounts?: AccountGroupDto[];

	@ApiPropertyOptional({
		type: AccountsInfoDto,
		description: "Financial summary (only when info=true)",
	})
	info?: AccountsInfoDto;

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

export class QueryAccountsDto {
	@ApiPropertyOptional({
		enum: AccountType,
		example: "DEBIT",
		description: "Filter by account type",
	})
	@IsOptional()
	@IsEnum(AccountType)
	type?: AccountType;

	@ApiPropertyOptional({ example: "bank-uuid", description: "Filter by bank" })
	@IsOptional()
	@IsString()
	bankId?: string;

	@ApiPropertyOptional({
		example: "checking",
		description: "Case-insensitive search by account name (substring match)",
	})
	@IsOptional()
	@IsString()
	search?: string;

	@ApiPropertyOptional({
		example: "true",
		description: 'Filter by active state (accepts "true"/"false")',
	})
	@IsOptional()
	@IsBooleanString()
	isActive?: string;

	@ApiPropertyOptional({
		enum: AccountSortBy,
		example: "createdAt",
		default: "createdAt",
		description: "Sort field",
	})
	@IsOptional()
	@IsEnum(AccountSortBy)
	sortBy?: AccountSortBy;

	@ApiPropertyOptional({
		enum: SortOrder,
		example: "desc",
		default: "desc",
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
		default: "false",
		description: 'Include financial info summary in the response (accepts "true"/"false")',
	})
	@IsOptional()
	@IsBooleanString()
	info?: string;

	@ApiPropertyOptional({
		enum: GroupBy,
		example: "banks",
		description:
			'Group accounts by bank ("banks") or account type ("types"). When set, returns groupedAccounts instead of accounts.',
	})
	@IsOptional()
	@IsEnum(GroupBy)
	groupedBy?: GroupBy;
}
