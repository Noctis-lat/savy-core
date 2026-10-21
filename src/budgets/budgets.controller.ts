import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
	ApiBearerAuth,
	ApiExtraModels,
	ApiOperation,
	ApiResponse,
	ApiTags,
	getSchemaPath,
} from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator";
import {
	ApiArraySuccessResponse,
	ApiErrorResponse,
	ApiMessageResponse,
	ApiSuccessResponse,
} from "../common/decorators/api-response.decorator";
import { PaginationMetaDto } from "../common/dto/pagination.dto";
import type { Profile } from "../generated/prisma/client";
import { TransactionResponseDto } from "../transactions/dto/transaction.dto";
import { BudgetsService } from "./budgets.service";
import {
	BudgetHistoryDto,
	BudgetProgressDto,
	BudgetResponseDto,
	BudgetsListResponseDto,
	CreateBudgetDto,
	QueryBudgetsDto,
	UpdateBudgetDto,
} from "./dto/budget.dto";
import { QueryBudgetTransactionsDto } from "./dto/budget-transactions.dto";

@ApiTags("budgets")
@ApiBearerAuth()
@Controller("budgets")
export class BudgetsController {
	constructor(private readonly budgetsService: BudgetsService) {}

	@Get()
	@ApiOperation({
		summary:
			"List budgets with pagination, per-budget expense progress and planned income/expense info",
	})
	@ApiSuccessResponse(
		200,
		BudgetsListResponseDto,
		"Returns paginated budgets with expense progress and planned totals across filtered budgets",
	)
	@ApiErrorResponse(400, "Invalid query parameters")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(500, "Internal server error")
	async findAll(@CurrentUser() profile: Profile, @Query() query: QueryBudgetsDto) {
		return this.budgetsService.findAllByProfile(profile.id, {
			isActive: query.isActive === undefined ? undefined : query.isActive === "true",
			kind: query.kind,
			period: query.period,
			sortBy: query.sortBy,
			order: query.order,
			page: query.page,
			perPage: query.perPage,
			search: query.search,
		});
	}

	@Get(":id")
	@ApiOperation({ summary: "Get a single budget by ID" })
	@ApiSuccessResponse(200, BudgetResponseDto, "Returns the budget with items")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Budget not found")
	@ApiErrorResponse(500, "Internal server error")
	async findOne(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.budgetsService.findOne(id, profile.id);
	}

	@Get(":id/progress")
	@ApiOperation({ summary: "Get per-item budget progress for the current period" })
	@ApiSuccessResponse(200, BudgetProgressDto, "Returns planned vs spent for the current period")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Budget not found")
	@ApiErrorResponse(500, "Internal server error")
	async getProgress(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.budgetsService.getProgress(id, profile.id);
	}

	@Get(":id/history")
	@ApiOperation({ summary: "Get closed-period snapshots for a budget (newest first)" })
	@ApiArraySuccessResponse(200, BudgetHistoryDto, "Returns period snapshots with items")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Budget not found")
	@ApiErrorResponse(500, "Internal server error")
	async getHistory(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.budgetsService.getHistory(id, profile.id);
	}

	@Get(":id/transactions")
	@ApiOperation({
		summary: "List transactions counted by a budget's categories (defaults to the current period)",
	})
	@ApiExtraModels(TransactionResponseDto, PaginationMetaDto)
	@ApiResponse({
		status: 200,
		description: "Returns paginated transactions for the budget's categories",
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
						meta: { $ref: getSchemaPath(PaginationMetaDto) },
					},
				},
				message: { type: "string", nullable: true },
			},
		},
	})
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Budget not found")
	@ApiErrorResponse(500, "Internal server error")
	async findTransactions(
		@Param("id") id: string,
		@CurrentUser() profile: Profile,
		@Query() query: QueryBudgetTransactionsDto,
	) {
		return this.budgetsService.findTransactions(id, profile.id, {
			type: query.type,
			categoryId: query.categoryId,
			search: query.search,
			from: query.from ? new Date(query.from) : undefined,
			to: query.to ? new Date(query.to) : undefined,
			page: query.page,
			limit: query.limit,
			sortBy: query.sortBy,
			order: query.order,
		});
	}

	@Post()
	@ApiOperation({ summary: "Create a budget with one or more category items" })
	@ApiSuccessResponse(201, BudgetResponseDto, "Returns the created budget")
	@ApiErrorResponse(400, "Validation error, invalid kind/period/endDate or duplicate category")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Category not found")
	@ApiErrorResponse(500, "Internal server error")
	async create(@CurrentUser() profile: Profile, @Body() dto: CreateBudgetDto) {
		return this.budgetsService.create(profile.id, dto);
	}

	@Patch(":id")
	@ApiOperation({ summary: "Update a budget; items, if provided, replace all existing items" })
	@ApiSuccessResponse(200, BudgetResponseDto, "Returns the updated budget")
	@ApiErrorResponse(400, "Validation error, invalid kind/period/endDate or duplicate category")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Budget or category not found")
	@ApiErrorResponse(500, "Internal server error")
	async update(
		@Param("id") id: string,
		@CurrentUser() profile: Profile,
		@Body() dto: UpdateBudgetDto,
	) {
		return this.budgetsService.update(id, profile.id, dto);
	}

	@Delete(":id")
	@ApiOperation({ summary: "Soft-delete a budget (deactivate)" })
	@ApiMessageResponse(200, "Budget deactivated")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Budget not found")
	@ApiErrorResponse(500, "Internal server error")
	async remove(@Param("id") id: string, @CurrentUser() profile: Profile) {
		await this.budgetsService.remove(id, profile.id);
		return { message: "Budget deactivated" };
	}
}
