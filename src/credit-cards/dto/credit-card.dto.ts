import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
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
	@ApiProperty({ example: "account-uuid", description: "Account ID (must be type CREDIT)" })
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

	@ApiPropertyOptional({
		example: 20,
		description: "Payment due days offset from cut day (replaces paymentDay). Default 20.",
	})
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(31)
	paymentDueDays?: number;

	@ApiPropertyOptional({
		example: 25,
		description: "Deprecated: fixed payment day of the month (1-31). Use paymentDueDays instead.",
	})
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(31)
	paymentDay?: number;

	@ApiPropertyOptional({
		example: 0,
		description: "Over-limit tolerance (amount above credit limit allowed for EXPENSE). Default 0.",
	})
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	overLimitTolerance?: number;

	@ApiProperty({ example: 0.36, description: "Annual interest rate as decimal (0.36 = 36%)" })
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	interestRate!: number;

	@ApiPropertyOptional({
		example: 12,
		description: "Number of months without interest (promotional)",
		required: false,
	})
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	noInterestMonths?: number;
}

export class UpdateCreditCardDto {
	@ApiPropertyOptional({ example: 50000, description: "Credit limit" })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	creditLimit?: number;

	@ApiPropertyOptional({ example: 15, description: "Cut day of the month (1-31)" })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(31)
	cutDay?: number;

	@ApiPropertyOptional({
		example: 20,
		description: "Payment due days offset from cut day (replaces paymentDay). Default 20.",
	})
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(31)
	paymentDueDays?: number;

	@ApiPropertyOptional({
		example: 25,
		description: "Deprecated: fixed payment day of the month (1-31). Use paymentDueDays instead.",
	})
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(31)
	paymentDay?: number;

	@ApiPropertyOptional({
		example: 0,
		description: "Over-limit tolerance amount. Default 0.",
	})
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	overLimitTolerance?: number;

	@ApiPropertyOptional({ example: 0.36, description: "Annual interest rate as decimal" })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	interestRate?: number;

	@ApiPropertyOptional({ example: 12, description: "Number of months without interest" })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	noInterestMonths?: number;
}

export class CreditCardResponseDto {
	@ApiProperty({ example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", description: "Credit card ID" })
	id!: string;

	@ApiProperty({ example: "account-uuid", description: "Associated account ID" })
	accountId!: string;

	@ApiProperty({ example: 50000, description: "Credit limit" })
	creditLimit!: number;

	@ApiProperty({ example: 15, description: "Cut day of the month" })
	cutDay!: number;

	@ApiPropertyOptional({
		example: 20,
		description: "Payment due days offset from cut day (replaces deprecated paymentDay)",
	})
	paymentDueDays?: number;

	@ApiPropertyOptional({
		example: 25,
		description: "Deprecated: fixed payment day of the month. Use paymentDueDays instead.",
	})
	paymentDay?: number;

	@ApiPropertyOptional({ example: 0, description: "Over-limit tolerance amount" })
	overLimitTolerance?: number;

	@ApiProperty({ example: 0.36, description: "Annual interest rate as decimal" })
	interestRate!: number;

	@ApiProperty({ example: 12, description: "Number of months without interest" })
	noInterestMonths!: number;

	@ApiProperty({
		example: "7000.00",
		description: "Available credit (creditLimit - account.balance), computed at response layer",
	})
	availableCredit!: string;

	@ApiProperty({
		example: "3000.00",
		description: "Current account balance (mapped from account.balance)",
	})
	currentBalance!: string;

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

export class QueryCreditCardsDto {
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
}
