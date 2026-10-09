import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
	IsBoolean,
	IsBooleanString,
	IsDateString,
	IsEnum,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	Min,
} from "class-validator";
import { TransactionResponseDto } from "../../transactions/dto/transaction.dto";

enum CardStatementSortBy {
	periodEnd = "periodEnd",
	balance = "balance",
	createdAt = "createdAt",
}

enum SortOrder {
	asc = "asc",
	desc = "desc",
}

export class CreateCardStatementDto {
	@ApiProperty({ example: "credit-card-uuid", description: "Credit card ID" })
	@IsString()
	@IsNotEmpty()
	creditCardId!: string;

	@ApiProperty({ example: "2026-07-01T00:00:00.000Z", description: "Statement period start" })
	@IsDateString()
	periodStart!: string;

	@ApiProperty({ example: "2026-07-31T23:59:59.999Z", description: "Statement period end" })
	@IsDateString()
	periodEnd!: string;

	/**
	 * @deprecated When CREDIT_CARD_REACTIVE_ENABLED=true, these calculated fields
	 * are rejected. Statements are auto-generated on read. Only accepted when the
	 * feature flag is off (legacy CRUD mode).
	 */
	@ApiProperty({
		example: 15000,
		description: "Statement balance (deprecated when reactive behavior enabled)",
		deprecated: true,
	})
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	balance!: number;

	@ApiProperty({
		example: 750,
		description: "Minimum payment (deprecated when reactive behavior enabled)",
		deprecated: true,
	})
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	minPayment!: number;

	@ApiProperty({
		example: 15000,
		description: "No-interest payment (deprecated when reactive behavior enabled)",
		deprecated: true,
	})
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	noInterestPayment!: number;

	@ApiPropertyOptional({
		example: 2250,
		description: "Interest amount (deprecated when reactive behavior enabled)",
		required: false,
		deprecated: true,
	})
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	interestAmount?: number;
}

export class UpdateCardStatementDto {
	@ApiPropertyOptional({ example: 15000, description: "Amount paid towards this statement" })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	paidAmount?: number;

	@ApiPropertyOptional({ example: true, description: "Whether the statement is fully paid" })
	@IsOptional()
	@IsBoolean()
	isPaid?: boolean;
}

export class CardStatementResponseDto {
	@ApiProperty({ example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", description: "Statement ID" })
	id!: string;

	@ApiProperty({ example: "credit-card-uuid", description: "Credit card ID" })
	creditCardId!: string;

	@ApiProperty({ example: "2026-07-01T00:00:00.000Z", description: "Period start" })
	periodStart!: Date;

	@ApiProperty({ example: "2026-07-31T23:59:59.999Z", description: "Period end" })
	periodEnd!: Date;

	@ApiProperty({ example: 15000, description: "Statement balance" })
	balance!: number;

	@ApiProperty({ example: 750, description: "Minimum payment" })
	minPayment!: number;

	@ApiProperty({ example: 15000, description: "No-interest payment" })
	noInterestPayment!: number;

	@ApiProperty({ example: 2250, description: "Interest amount" })
	interestAmount!: number;

	@ApiProperty({ example: false, description: "Whether the statement is paid" })
	isPaid!: boolean;

	@ApiPropertyOptional({
		example: "2026-11-04T00:00:00.000Z",
		description: "Payment due date (calculated)",
	})
	@IsOptional()
	@IsDateString()
	paymentDueDate?: Date;

	@ApiPropertyOptional({
		example: 2000,
		description: "Amount paid towards this statement",
		required: false,
	})
	paidAmount?: number;

	@ApiPropertyOptional({
		example: 3000,
		description: "Remaining balance after partial payment",
		required: false,
	})
	remainingBalance?: number;

	@ApiPropertyOptional({
		example: true,
		description: "Whether this statement was auto-generated",
		required: false,
	})
	isGenerated?: boolean;

	@ApiPropertyOptional({
		example: "2026-10-15T12:00:00.000Z",
		description: "Last update timestamp",
		required: false,
	})
	updatedAt?: Date;

	@ApiProperty({ example: "2026-07-28T20:00:00.000Z", description: "Creation date" })
	createdAt!: Date;
}

export class QueryCardStatementsDto {
	@ApiPropertyOptional({ example: "credit-card-uuid", description: "Filter by credit card" })
	@IsOptional()
	@IsString()
	creditCardId?: string;

	@ApiPropertyOptional({
		example: "false",
		description: 'Filter by paid state (accepts "true"/"false")',
	})
	@IsOptional()
	@IsBooleanString()
	isPaid?: string;

	@ApiPropertyOptional({
		enum: CardStatementSortBy,
		example: "createdAt",
		default: "createdAt",
		description: "Sort field",
	})
	@IsOptional()
	@IsEnum(CardStatementSortBy)
	sortBy?: CardStatementSortBy;

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

// ─── Statement detail (GET /card-statements/:id/transactions) ────────────

export class InstallmentPurchaseDto {
	@ApiProperty({ example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", description: "Purchase ID" })
	id!: string;

	@ApiProperty({
		example: "Laptop",
		nullable: true,
		type: String,
		description: "Purchase description",
	})
	description!: string | null;

	@ApiProperty({ example: "3000.00", description: "Full purchase amount (2 decimals)" })
	amount!: string;

	@ApiProperty({ example: "2026-10-05T12:00:00.000Z", description: "Purchase date" })
	date!: Date;
}

export class InstallmentDetailDto {
	@ApiProperty({ example: 2, description: "Number of this installment (1-based)" })
	number!: number;

	@ApiProperty({ example: 3, description: "Total installments of the plan" })
	totalInstallments!: number;

	@ApiProperty({ example: 2, description: "Installment rows billed so far" })
	billedInstallments!: number;

	@ApiProperty({
		example: 1,
		description: "Installments whose statement is paid (all of them when the plan is PAID_OFF)",
	})
	paidInstallments!: number;

	@ApiProperty({ example: 2, description: "totalInstallments − paidInstallments" })
	remainingInstallments!: number;

	@ApiProperty({ example: "1000.00", description: "Mensualidad (principal + interest)" })
	monthlyAmount!: string;

	@ApiProperty({ example: "1000.00", description: "Principal part of this installment" })
	principalAmount!: string;

	@ApiProperty({ example: "0.00", description: "Interest part of this installment (0 for MSI)" })
	interestAmount!: string;

	@ApiProperty({
		example: "2000.00",
		description: "Unpaid principal: purchase × remainingInstallments / total (0 if PAID_OFF)",
	})
	remainingAmount!: string;

	@ApiProperty({ enum: ["MSI", "MSCI"], example: "MSI", description: "Installment plan type" })
	type!: "MSI" | "MSCI";

	@ApiProperty({
		enum: ["ACTIVE", "COMPLETED", "CANCELLED", "PAID_OFF"],
		example: "ACTIVE",
		description: "Installment plan status",
	})
	status!: "ACTIVE" | "COMPLETED" | "CANCELLED" | "PAID_OFF";

	@ApiProperty({ type: () => InstallmentPurchaseDto, description: "Original purchase" })
	purchase!: InstallmentPurchaseDto;
}

export class StatementTransactionResponseDto extends TransactionResponseDto {
	@ApiProperty({
		type: () => InstallmentDetailDto,
		nullable: true,
		description: "Installment summary for INSTALLMENT rows; null for every other row",
	})
	installment!: InstallmentDetailDto | null;
}
