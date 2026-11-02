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

enum CreditCardSortBy {
	createdAt = "createdAt",
	creditLimit = "creditLimit",
}

enum SortOrder {
	asc = "asc",
	desc = "desc",
}

export class CreateCreditCardDto {
	@ApiProperty({
		example: "account-uuid",
		description: "Account ID (must be type CREDIT). The card inherits its name/color/icon.",
	})
	@IsString()
	@IsNotEmpty()
	accountId!: string;

	@ApiProperty({ example: 50000, description: "Credit limit" })
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	creditLimit!: number;

	@ApiProperty({ example: 15, description: "Cut day of the month (1-31)" })
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(31)
	cutDay!: number;

	@ApiProperty({
		example: 5,
		description:
			"Payment day of the month (1-31). Converted server-side into paymentDueDays (offset from cut day).",
	})
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(31)
	paymentDay!: number;

	@ApiProperty({ example: 0.36, description: "Annual interest rate as decimal (0.36 = 36%)" })
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	interestRate!: number;
}

export class UpdateCreditCardDto {
	@ApiPropertyOptional({ example: 50000, description: "Credit limit" })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	creditLimit?: number;

	@ApiPropertyOptional({
		example: 15,
		description:
			"Cut day of the month (1-31). Changing only the cut day keeps the paymentDueDays offset.",
	})
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(31)
	cutDay?: number;

	@ApiPropertyOptional({
		example: 5,
		description:
			"Payment day of the month (1-31). Recomputes paymentDueDays from the (new or current) cut day.",
	})
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(31)
	paymentDay?: number;

	@ApiPropertyOptional({ example: 0.36, description: "Annual interest rate as decimal" })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	interestRate?: number;

	@ApiPropertyOptional({
		example: "Visa Oro",
		description: "Card name (synced to the linked account)",
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	name?: string;

	@ApiPropertyOptional({
		example: "#1E40AF",
		description: "Card color (synced to the linked account)",
	})
	@IsOptional()
	@IsString()
	color?: string;

	@ApiPropertyOptional({
		example: "credit-card",
		description: "Card icon (synced to the linked account)",
	})
	@IsOptional()
	@IsString()
	icon?: string;
}

export class CreditCardResponseDto {
	@ApiProperty({ example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", description: "Credit card ID" })
	id!: string;

	@ApiProperty({ example: "account-uuid", description: "Associated account ID" })
	accountId!: string;

	@ApiProperty({ example: "Visa Oro", description: "Card name (source of truth for the account)" })
	name!: string;

	@ApiPropertyOptional({ example: "#1E40AF", description: "Card color", nullable: true })
	color!: string | null;

	@ApiPropertyOptional({ example: "credit-card", description: "Card icon", nullable: true })
	icon!: string | null;

	@ApiProperty({ example: 50000, description: "Credit limit" })
	creditLimit!: number;

	@ApiProperty({ example: 15, description: "Cut day of the month" })
	cutDay!: number;

	@ApiPropertyOptional({
		example: 20,
		description: "Payment due days offset from cut day (computed server-side from paymentDay)",
	})
	paymentDueDays?: number;

	@ApiPropertyOptional({
		example: 25,
		description: "Deprecated: legacy fixed payment day. No longer written; use paymentDueDays.",
	})
	paymentDay?: number;

	@ApiPropertyOptional({ example: 0, description: "Over-limit tolerance amount" })
	overLimitTolerance?: number;

	@ApiProperty({ example: 0.36, description: "Annual interest rate as decimal" })
	interestRate!: number;

	@ApiProperty({
		example: 7000.0,
		description: "Available credit (creditLimit - account.balance), computed at response layer",
	})
	availableCredit!: number;

	@ApiProperty({
		example: 3000.0,
		description: "Current account balance (mapped from account.balance)",
	})
	currentBalance!: number;

	@ApiPropertyOptional({
		example: "2026-11-04T00:00:00.000Z",
		description: "Next payment due date from latest unpaid statement, or null",
	})
	nextPaymentDueDate!: Date | null;

	@ApiProperty({ example: "2026-07-28T20:00:00.000Z", description: "Creation date" })
	createdAt!: Date;

	@ApiProperty({ example: "2026-07-28T20:00:00.000Z", description: "Last update date" })
	updatedAt!: Date;
}

export class CreditCardInfoDto {
	@ApiProperty({ example: 47000, description: "Total available credit across all cards" })
	totalAvailableCredit!: number;

	@ApiProperty({
		example: 3000,
		description:
			"Sum of 'pago para no generar intereses' from latest unpaid statement of each card",
	})
	totalNoInterestPayment!: number;

	@ApiProperty({
		example: 1500,
		description: "Sum of minimum payments from latest unpaid statement of each card",
	})
	totalMinPayment!: number;

	@ApiProperty({
		example: 53000,
		description: "Total debt (sum of current balances) across all cards",
	})
	totalDebt!: number;

	@ApiProperty({ example: 3, description: "Total count of credit cards" })
	total!: number;
}

export class CreditCardListResponseDto {
	@ApiProperty({
		type: () => [CreditCardResponseDto],
		description: "Credit cards in the current page",
	})
	data!: CreditCardResponseDto[];

	@ApiProperty({
		type: () => CreditCardInfoDto,
		description: "Aggregated totals across all cards (not just this page)",
	})
	info!: CreditCardInfoDto;

	@ApiProperty({ example: 1, description: "Current page number" })
	page!: number;

	@ApiProperty({ example: 10, description: "Items per page" })
	perPage!: number;

	@ApiProperty({ example: 3, description: "Total matching items across all pages" })
	total!: number;

	@ApiProperty({ example: 1, description: "Total pages (ceil(total / perPage))" })
	totalPages!: number;
}

export class QueryCreditCardsDto {
	@ApiPropertyOptional({
		example: "visa",
		description: "Search by credit card name (case-insensitive)",
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	search?: string;

	@ApiPropertyOptional({
		example: "true",
		default: "true",
		description: "Filter by account active state (accepts 'true'/'false')",
	})
	@IsOptional()
	@IsBooleanString()
	isActive?: string;

	@ApiPropertyOptional({
		example: "bank-uuid",
		description: "Filter by associated bank ID",
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	bankId?: string;

	@ApiPropertyOptional({
		example: "true",
		description: "Filter cards that have at least one unpaid statement (accepts 'true'/'false')",
	})
	@IsOptional()
	@IsBooleanString()
	hasUnpaidStatement?: string;

	@ApiPropertyOptional({
		enum: CreditCardSortBy,
		example: "createdAt",
		default: "createdAt",
		description: "Sort field",
	})
	@IsOptional()
	@IsEnum(CreditCardSortBy)
	sortBy?: CreditCardSortBy;

	@ApiPropertyOptional({
		enum: SortOrder,
		example: "desc",
		default: "desc",
		description: "Sort order",
	})
	@IsOptional()
	@IsEnum(SortOrder)
	order?: SortOrder;

	@ApiPropertyOptional({ example: 1, default: 1, minimum: 1, description: "Page number (1-based)" })
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
