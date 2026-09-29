import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
	ApiBearerAuth,
	ApiExtraModels,
	ApiOperation,
	ApiQuery,
	ApiResponse,
	ApiTags,
	getSchemaPath,
} from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator";
import {
	ApiErrorResponse,
	ApiMessageResponse,
	ApiSuccessResponse,
} from "../common/decorators/api-response.decorator";
import { PaginationMetaDto } from "../common/dto/pagination.dto";
import type { Profile } from "../generated/prisma/client";
import {
	CreateTransactionDto,
	QueryTransactionsDto,
	TransactionResponseDto,
	TransactionsInfoDto,
	UpdateTransactionDto,
} from "./dto/transaction.dto";
import { TransactionsService } from "./transactions.service";

@ApiTags("transactions")
@ApiBearerAuth()
@Controller("transactions")
export class TransactionsController {
	constructor(private readonly transactionsService: TransactionsService) {}

	@Get()
	@ApiOperation({ summary: "List transactions with filters, sort, and pagination" })
	@ApiQuery({
		name: "accountId",
		required: false,
		description: "Filter by account (source or destination)",
	})
	@ApiQuery({ name: "type", enum: ["INCOME", "EXPENSE", "TRANSFER", "PAYMENT"], required: false })
	@ApiQuery({ name: "categoryId", required: false, description: "Filter by category" })
	@ApiQuery({
		name: "bankId",
		required: false,
		description: "Filter by accounts belonging to this bank",
	})
	@ApiQuery({
		name: "search",
		required: false,
		description: "Partial case-insensitive search in description",
	})
	@ApiQuery({ name: "from", required: false, description: "Start date (ISO 8601)" })
	@ApiQuery({ name: "to", required: false, description: "End date (ISO 8601)" })
	@ApiQuery({ name: "page", required: false, description: "Page number (default 1)" })
	@ApiQuery({ name: "limit", required: false, description: "Items per page (default 50, max 100)" })
	@ApiQuery({
		name: "sortBy",
		enum: ["date", "amount", "createdAt"],
		required: false,
		description: "Sort field (default date)",
	})
	@ApiQuery({
		name: "order",
		enum: ["asc", "desc"],
		required: false,
		description: "Sort order (default desc)",
	})
	@ApiQuery({
		name: "info",
		required: false,
		description:
			'Include financial info summary (netWorth, liquidity, debt) in the response (accepts "true"/"false")',
	})
	@ApiQuery({
		name: "period",
		enum: ["day", "week", "month", "other_month", "quarter", "semester", "year"],
		required: false,
		description:
			"Filter transactions by period. When set, overrides from/to with the computed date range.",
	})
	@ApiExtraModels(TransactionResponseDto, TransactionsInfoDto, PaginationMetaDto)
	@ApiResponse({
		status: 200,
		description: "Returns paginated transactions with optional financial info",
		schema: {
			type: "object",
			properties: {
				success: { type: "boolean", example: true },
				data: {
					type: "object",
					properties: {
						data: {
							type: "array",
							items: { $ref: getSchemaPath(TransactionResponseDto) },
						},
						info: {
							$ref: getSchemaPath(TransactionsInfoDto),
							description: "Financial summary (only when info=true)",
						},
						meta: { $ref: getSchemaPath(PaginationMetaDto) },
					},
				},
				message: { type: "string", nullable: true },
			},
		},
	})
	@ApiErrorResponse(422, "Invalid period value")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(500, "Internal server error")
	async findAll(@CurrentUser() profile: Profile, @Query() query: QueryTransactionsDto) {
		return this.transactionsService.findAllByProfile(profile.id, {
			accountId: query.accountId,
			type: query.type,
			categoryId: query.categoryId,
			bankId: query.bankId,
			search: query.search,
			from: query.from ? new Date(query.from) : undefined,
			to: query.to ? new Date(query.to) : undefined,
			page: query.page,
			limit: query.limit,
			sortBy: query.sortBy,
			order: query.order,
			includeInfo: query.info === "true",
			period: query.period,
		});
	}

	@Get(":id")
	@ApiOperation({ summary: "Get a single transaction by ID" })
	@ApiSuccessResponse(200, TransactionResponseDto, "Returns the transaction")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Transaction not found")
	@ApiErrorResponse(500, "Internal server error")
	async findOne(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.transactionsService.findOne(id, profile.id);
	}

	@Post()
	@ApiOperation({ summary: "Create a new transaction (automatically updates account balances)" })
	@ApiSuccessResponse(201, TransactionResponseDto, "Returns the created transaction")
	@ApiErrorResponse(
		400,
		"Validation error or invalid transaction rules (destination account, category type mismatch)",
	)
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Account or category not found")
	@ApiErrorResponse(500, "Internal server error")
	async create(@CurrentUser() profile: Profile, @Body() dto: CreateTransactionDto) {
		return this.transactionsService.create(profile.id, dto);
	}

	@Patch(":id")
	@ApiOperation({ summary: "Update a transaction (reverses old balance, applies new)" })
	@ApiSuccessResponse(200, TransactionResponseDto, "Returns the updated transaction")
	@ApiErrorResponse(400, "Validation error or invalid request data")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Transaction not found")
	@ApiErrorResponse(500, "Internal server error")
	async update(
		@Param("id") id: string,
		@CurrentUser() profile: Profile,
		@Body() dto: UpdateTransactionDto,
	) {
		return this.transactionsService.update(id, profile.id, dto);
	}

	@Delete(":id")
	@ApiOperation({ summary: "Delete a transaction (reverses balance effect)" })
	@ApiMessageResponse(200, "Transaction deleted")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Transaction not found")
	@ApiErrorResponse(500, "Internal server error")
	async remove(@Param("id") id: string, @CurrentUser() profile: Profile) {
		await this.transactionsService.remove(id, profile.id);
		return { message: "Transaction deleted" };
	}
}
