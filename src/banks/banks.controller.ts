import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AccountResponseDto } from "../accounts/dto/account.dto";
import { CurrentUser } from "../auth/current-user.decorator";
import {
	ApiArraySuccessResponse,
	ApiErrorResponse,
	ApiMessageResponse,
	ApiSuccessResponse,
} from "../common/decorators/api-response.decorator";
import type { Profile } from "../generated/prisma/client";
import { BanksService } from "./banks.service";
import { BankResponseDto, CreateBankDto, QueryBanksDto, UpdateBankDto } from "./dto/bank.dto";
import { BankCreditCardResponseDto, BankLoanResponseDto } from "./dto/bank-sub-resources.dto";
import {
	IncomeVsExpensesResponseDto,
	QueryIncomeVsExpensesDto,
} from "./dto/income-vs-expenses.dto";

@ApiTags("banks")
@ApiBearerAuth()
@Controller("banks")
export class BanksController {
	constructor(private readonly banksService: BanksService) {}

	@Get()
	@ApiOperation({
		summary: "List all banks for the current user with optional filters and KPIs",
	})
	@ApiArraySuccessResponse(200, BankResponseDto, "Returns array of banks")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(500, "Internal server error")
	async findAll(@CurrentUser() profile: Profile, @Query() query: QueryBanksDto) {
		return this.banksService.findAllByProfile(profile.id, {
			isActive: query.isActive === undefined ? undefined : query.isActive === "true",
			sortBy: query.sortBy,
			order: query.order,
			withInfo: query.info === "true",
		});
	}

	@Get(":id/income-vs-expenses")
	@ApiOperation({ summary: "Get income vs expenses for a bank in a given period" })
	@ApiSuccessResponse(
		200,
		IncomeVsExpensesResponseDto,
		"Returns income and expenses totals for the period",
	)
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Bank not found")
	@ApiErrorResponse(422, "Invalid period value")
	@ApiErrorResponse(500, "Internal server error")
	async getIncomeVsExpenses(
		@Param("id") id: string,
		@Query() query: QueryIncomeVsExpensesDto,
		@CurrentUser() profile: Profile,
	) {
		return this.banksService.getIncomeVsExpenses(id, profile.id, query.period ?? "month");
	}

	@Get(":id/accounts")
	@ApiOperation({ summary: "List all active accounts belonging to a bank" })
	@ApiArraySuccessResponse(200, AccountResponseDto, "Returns array of accounts for this bank")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Bank not found")
	@ApiErrorResponse(500, "Internal server error")
	async findAccountsByBank(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.banksService.findAccountsByBank(id, profile.id);
	}

	@Get(":id/credit-cards")
	@ApiOperation({ summary: "List all credit cards belonging to a bank" })
	@ApiArraySuccessResponse(
		200,
		BankCreditCardResponseDto,
		"Returns array of credit cards for this bank",
	)
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Bank not found")
	@ApiErrorResponse(500, "Internal server error")
	async findCreditCardsByBank(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.banksService.findCreditCardsByBank(id, profile.id);
	}

	@Get(":id/loans")
	@ApiOperation({ summary: "List all loans belonging to a bank with computed progress" })
	@ApiArraySuccessResponse(200, BankLoanResponseDto, "Returns array of loans for this bank")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Bank not found")
	@ApiErrorResponse(500, "Internal server error")
	async findLoansByBank(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.banksService.findLoansByBank(id, profile.id);
	}

	@Get(":id")
	@ApiOperation({ summary: "Get a single bank by ID, optionally with financial KPIs" })
	@ApiSuccessResponse(200, BankResponseDto, "Returns the bank, with info block when ?info=true")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Bank not found")
	@ApiErrorResponse(500, "Internal server error")
	async findOne(
		@Param("id") id: string,
		@CurrentUser() profile: Profile,
		@Query() query: QueryBanksDto,
	) {
		return this.banksService.findOne(id, profile.id, query.info === "true");
	}

	@Post()
	@ApiOperation({ summary: "Create a new bank" })
	@ApiSuccessResponse(201, BankResponseDto, "Returns the created bank")
	@ApiErrorResponse(400, "Validation error or invalid request data")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(500, "Internal server error")
	async create(@CurrentUser() profile: Profile, @Body() dto: CreateBankDto) {
		return this.banksService.create(profile.id, dto);
	}

	@Patch(":id")
	@ApiOperation({ summary: "Update a bank by ID" })
	@ApiSuccessResponse(200, BankResponseDto, "Returns the updated bank")
	@ApiErrorResponse(400, "Validation error or invalid request data")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Bank not found")
	@ApiErrorResponse(500, "Internal server error")
	async update(
		@Param("id") id: string,
		@CurrentUser() profile: Profile,
		@Body() dto: UpdateBankDto,
	) {
		return this.banksService.update(id, profile.id, dto);
	}

	@Delete(":id")
	@ApiOperation({ summary: "Soft-delete a bank (deactivate)" })
	@ApiMessageResponse(200, "Bank deactivated")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Bank not found")
	@ApiErrorResponse(500, "Internal server error")
	async remove(@Param("id") id: string, @CurrentUser() profile: Profile) {
		await this.banksService.remove(id, profile.id);
		return { message: "Bank deactivated" };
	}
}
