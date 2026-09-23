import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Min } from "class-validator";

enum TransactionType {
	INCOME = "INCOME",
	EXPENSE = "EXPENSE",
	TRANSFER = "TRANSFER",
	PAYMENT = "PAYMENT",
}

enum TransactionSortBy {
	date = "date",
	amount = "amount",
	createdAt = "createdAt",
}

enum SortOrder {
	asc = "asc",
	desc = "desc",
}

export class QueryAccountTransactionsDto {
	@ApiPropertyOptional({
		enum: TransactionType,
		example: "EXPENSE",
		description: "Filter by transaction type",
	})
	@IsOptional()
	@IsEnum(TransactionType)
	type?: TransactionType;

	@ApiPropertyOptional({ example: "category-uuid", description: "Filter by category" })
	@IsOptional()
	@IsString()
	categoryId?: string;

	@ApiPropertyOptional({
		example: "grocery",
		description: "Partial case-insensitive search in description",
	})
	@IsOptional()
	@IsString()
	search?: string;

	@ApiPropertyOptional({
		example: "2026-07-01T00:00:00.000Z",
		description: "Start date (ISO 8601)",
	})
	@IsOptional()
	@IsDateString()
	from?: string;

	@ApiPropertyOptional({ example: "2026-07-31T23:59:59.999Z", description: "End date (ISO 8601)" })
	@IsOptional()
	@IsDateString()
	to?: string;

	@ApiPropertyOptional({ example: 1, description: "Page number (default 1)" })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	page?: number;

	@ApiPropertyOptional({ example: 50, description: "Items per page (default 50, max 100)" })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	limit?: number;

	@ApiPropertyOptional({
		enum: TransactionSortBy,
		example: "date",
		default: "date",
		description: "Sort field",
	})
	@IsOptional()
	@IsEnum(TransactionSortBy)
	sortBy?: TransactionSortBy;

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
