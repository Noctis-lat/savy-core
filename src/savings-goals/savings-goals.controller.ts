import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator";
import {
	ApiErrorResponse,
	ApiMessageResponse,
	ApiSuccessResponse,
} from "../common/decorators/api-response.decorator";
import type { Profile } from "../generated/prisma/client";
import {
	CreateSavingsGoalDto,
	QuerySavingsGoalsDto,
	SavingsGoalResponseDto,
	SavingsGoalsListResponseDto,
	UpdateSavingsGoalDto,
} from "./dto/savings-goal.dto";
import { SavingsGoalsService } from "./savings-goals.service";

@ApiTags("savings-goals")
@ApiBearerAuth()
@Controller("savings-goals")
export class SavingsGoalsController {
	constructor(private readonly savingsGoalsService: SavingsGoalsService) {}

	@Get()
	@ApiOperation({
		summary: "List savings goals with pagination, search and totals info (count + total saved)",
	})
	@ApiSuccessResponse(
		200,
		SavingsGoalsListResponseDto,
		"Returns paginated savings goals with computed progress and totals across filtered goals",
	)
	@ApiErrorResponse(400, "Invalid query parameters")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(500, "Internal server error")
	async findAll(@CurrentUser() profile: Profile, @Query() query: QuerySavingsGoalsDto) {
		return this.savingsGoalsService.findAllByProfile(profile.id, {
			isCompleted: query.isCompleted === undefined ? undefined : query.isCompleted === "true",
			sortBy: query.sortBy,
			order: query.order,
			search: query.search,
			page: query.page,
			perPage: query.perPage,
		});
	}

	@Get("account/:accountId")
	@ApiOperation({ summary: "Get the savings goal linked to a given account ID" })
	@ApiSuccessResponse(
		200,
		SavingsGoalResponseDto,
		"Returns the savings goal linked to the account, with computed progress",
	)
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Savings goal not found for this account")
	@ApiErrorResponse(500, "Internal server error")
	async findByAccount(@Param("accountId") accountId: string, @CurrentUser() profile: Profile) {
		return this.savingsGoalsService.findByAccount(accountId, profile.id);
	}

	@Get(":id")
	@ApiOperation({ summary: "Get a single savings goal by ID" })
	@ApiSuccessResponse(
		200,
		SavingsGoalResponseDto,
		"Returns the savings goal with computed progress",
	)
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Savings goal not found")
	@ApiErrorResponse(500, "Internal server error")
	async findOne(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.savingsGoalsService.findOne(id, profile.id);
	}

	@Post()
	@ApiOperation({ summary: "Create a new savings goal" })
	@ApiSuccessResponse(201, SavingsGoalResponseDto, "Returns the created savings goal")
	@ApiErrorResponse(400, "Validation error or account must be DEBIT or CASH")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Account not found")
	@ApiErrorResponse(500, "Internal server error")
	async create(@CurrentUser() profile: Profile, @Body() dto: CreateSavingsGoalDto) {
		return this.savingsGoalsService.create(profile.id, dto);
	}

	@Patch(":id")
	@ApiOperation({ summary: "Update a savings goal by ID" })
	@ApiSuccessResponse(200, SavingsGoalResponseDto, "Returns the updated savings goal")
	@ApiErrorResponse(400, "Validation error or invalid request data")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Savings goal not found")
	@ApiErrorResponse(500, "Internal server error")
	async update(
		@Param("id") id: string,
		@CurrentUser() profile: Profile,
		@Body() dto: UpdateSavingsGoalDto,
	) {
		return this.savingsGoalsService.update(id, profile.id, dto);
	}

	@Delete(":id")
	@ApiOperation({
		summary:
			"Delete a savings goal and its backing account (cascade: transactions, cards, loans on that account are also removed)",
	})
	@ApiMessageResponse(200, "Savings goal and its account deleted")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Savings goal not found")
	@ApiErrorResponse(500, "Internal server error")
	async remove(@Param("id") id: string, @CurrentUser() profile: Profile) {
		await this.savingsGoalsService.remove(id, profile.id);
		return { message: "Savings goal and its account deleted" };
	}
}
