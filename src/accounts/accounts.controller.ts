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
	ApiErrorResponse,
	ApiMessageResponse,
	ApiSuccessResponse,
} from "../common/decorators/api-response.decorator";
import { PaginationMetaDto } from "../common/dto/pagination.dto";
import type { Profile } from "../generated/prisma/client";
import { TransactionResponseDto } from "../transactions/dto/transaction.dto";
import { AccountsService } from "./accounts.service";
import {
	AccountGroupDto,
	AccountResponseDto,
	AccountsInfoDto,
	AccountsListDataDto,
	CreateAccountDto,
	QueryAccountsDto,
	UpdateAccountDto,
} from "./dto/account.dto";
import {
	AccountIncomeVsExpensesResponseDto,
	QueryAccountIncomeVsExpensesDto,
} from "./dto/account-income-vs-expenses.dto";
import { QueryAccountTransactionsDto } from "./dto/account-transactions.dto";

@ApiTags("accounts")
@ApiBearerAuth()
@Controller("accounts")
export class AccountsController {
	constructor(private readonly accountsService: AccountsService) {}

	@Get()
	@ApiOperation({
		summary: "List all accounts for the current user with pagination and optional financial info",
	})
	@ApiExtraModels(AccountsListDataDto, AccountResponseDto, AccountsInfoDto, AccountGroupDto)
	@ApiResponse({
		status: 200,
		description: "Returns paginated accounts with optional financial info",
		schema: {
			type: "object",
			properties: {
				success: { type: "boolean", example: true },
				data: { $ref: getSchemaPath(AccountsListDataDto) },
				message: { type: "string", nullable: true },
			},
		},
	})
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(500, "Internal server error")
	async findAll(@CurrentUser() profile: Profile, @Query() query: QueryAccountsDto) {
		return this.accountsService.findAllByProfile(profile.id, {
			type: query.type,
			bankId: query.bankId,
			isActive: query.isActive === undefined ? undefined : query.isActive === "true",
			sortBy: query.sortBy,
			order: query.order,
			page: query.page,
			perPage: query.perPage,
			includeInfo: query.info === "true",
			search: query.search,
			groupedBy: query.groupedBy,
		});
	}

	@Get(":id/transactions")
	@ApiOperation({ summary: "List all transactions for a specific account" })
	@ApiExtraModels(TransactionResponseDto, PaginationMetaDto)
	@ApiResponse({
		status: 200,
		description: "Returns paginated transactions for the account",
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
	@ApiErrorResponse(404, "Account not found")
	@ApiErrorResponse(500, "Internal server error")
	async findTransactions(
		@Param("id") id: string,
		@CurrentUser() profile: Profile,
		@Query() query: QueryAccountTransactionsDto,
	) {
		return this.accountsService.findTransactions(id, profile.id, {
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

	@Get(":id/income-vs-expenses")
	@ApiOperation({ summary: "Get income vs expenses for an account in a given period" })
	@ApiSuccessResponse(
		200,
		AccountIncomeVsExpensesResponseDto,
		"Returns income and expenses totals for the period",
	)
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Account not found")
	@ApiErrorResponse(422, "Invalid period value")
	@ApiErrorResponse(500, "Internal server error")
	async getIncomeVsExpenses(
		@Param("id") id: string,
		@Query() query: QueryAccountIncomeVsExpensesDto,
		@CurrentUser() profile: Profile,
	) {
		return this.accountsService.getIncomeVsExpenses(id, profile.id, query.period ?? "month");
	}

	@Get(":id")
	@ApiOperation({ summary: "Get a single account by ID" })
	@ApiSuccessResponse(200, AccountResponseDto, "Returns the account")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Account not found")
	@ApiErrorResponse(500, "Internal server error")
	async findOne(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.accountsService.findOne(id, profile.id);
	}

	@Post()
	@ApiOperation({ summary: "Create a new account" })
	@ApiSuccessResponse(201, AccountResponseDto, "Returns the created account")
	@ApiErrorResponse(400, "Validation error or invalid request data")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(500, "Internal server error")
	async create(@CurrentUser() profile: Profile, @Body() dto: CreateAccountDto) {
		return this.accountsService.create(profile.id, dto);
	}

	@Patch(":id")
	@ApiOperation({ summary: "Update an account by ID" })
	@ApiSuccessResponse(200, AccountResponseDto, "Returns the updated account")
	@ApiErrorResponse(400, "Validation error or invalid request data")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Account not found")
	@ApiErrorResponse(500, "Internal server error")
	async update(
		@Param("id") id: string,
		@CurrentUser() profile: Profile,
		@Body() dto: UpdateAccountDto,
	) {
		return this.accountsService.update(id, profile.id, dto);
	}

	@Delete(":id")
	@ApiOperation({ summary: "Soft-delete an account (deactivate)" })
	@ApiMessageResponse(200, "Account deactivated")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Account not found")
	@ApiErrorResponse(500, "Internal server error")
	async remove(@Param("id") id: string, @CurrentUser() profile: Profile) {
		await this.accountsService.remove(id, profile.id);
		return { message: "Account deactivated" };
	}
}
