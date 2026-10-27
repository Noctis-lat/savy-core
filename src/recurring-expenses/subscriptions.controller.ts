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
	CreateRecurringByTypeDto,
	QueryRecurringByTypeDto,
	RecurringByTypeListResponseDto,
	RecurringExpenseResponseDto,
	UpdateRecurringByTypeDto,
} from "./dto/recurring-expense.dto";
import { RecurringExpensesService } from "./recurring-expenses.service";

@ApiTags("subscriptions")
@ApiBearerAuth()
@Controller("subscriptions")
export class SubscriptionsController {
	constructor(private readonly recurringExpensesService: RecurringExpensesService) {}

	@Get()
	@ApiOperation({
		summary:
			"List subscriptions (recurring expenses of type SUBSCRIPTION) with pagination, search and totals info",
	})
	@ApiSuccessResponse(
		200,
		RecurringByTypeListResponseDto,
		"Returns paginated subscriptions with totals info (count + sum of amounts)",
	)
	@ApiErrorResponse(400, "Invalid query parameters")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(500, "Internal server error")
	async findAll(@CurrentUser() profile: Profile, @Query() query: QueryRecurringByTypeDto) {
		return this.recurringExpensesService.findAllByType(profile.id, "SUBSCRIPTION", {
			isActive: query.isActive === undefined ? undefined : query.isActive === "true",
			sortBy: query.sortBy,
			order: query.order,
			search: query.search,
			page: query.page,
			perPage: query.perPage,
		});
	}

	@Get(":id")
	@ApiOperation({ summary: "Get a single subscription by ID" })
	@ApiSuccessResponse(200, RecurringExpenseResponseDto, "Returns the subscription")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Recurring expense not found")
	@ApiErrorResponse(500, "Internal server error")
	async findOne(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.recurringExpensesService.findOneByType(id, profile.id, "SUBSCRIPTION");
	}

	@Post()
	@ApiOperation({
		summary: "Create a new subscription (recurring expense of type SUBSCRIPTION)",
	})
	@ApiSuccessResponse(201, RecurringExpenseResponseDto, "Returns the created subscription")
	@ApiErrorResponse(400, "Validation error or invalid request data")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(500, "Internal server error")
	async create(@CurrentUser() profile: Profile, @Body() dto: CreateRecurringByTypeDto) {
		return this.recurringExpensesService.createByType(profile.id, "SUBSCRIPTION", dto);
	}

	@Patch(":id")
	@ApiOperation({ summary: "Update a subscription by ID" })
	@ApiSuccessResponse(200, RecurringExpenseResponseDto, "Returns the updated subscription")
	@ApiErrorResponse(400, "Validation error or invalid request data")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Recurring expense not found")
	@ApiErrorResponse(500, "Internal server error")
	async update(
		@Param("id") id: string,
		@CurrentUser() profile: Profile,
		@Body() dto: UpdateRecurringByTypeDto,
	) {
		return this.recurringExpensesService.updateByType(id, profile.id, "SUBSCRIPTION", dto);
	}

	@Delete(":id")
	@ApiOperation({
		summary: "Cancel a subscription (soft delete — deactivates but keeps history)",
	})
	@ApiMessageResponse(200, "Subscription cancelled")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Recurring expense not found")
	@ApiErrorResponse(500, "Internal server error")
	async cancel(@Param("id") id: string, @CurrentUser() profile: Profile) {
		await this.recurringExpensesService.cancelByType(id, profile.id, "SUBSCRIPTION");
		return { message: "Subscription cancelled" };
	}

	@Patch(":id/activate")
	@ApiOperation({ summary: "Reactivate a previously cancelled subscription" })
	@ApiSuccessResponse(200, RecurringExpenseResponseDto, "Returns the reactivated subscription")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Recurring expense not found")
	@ApiErrorResponse(500, "Internal server error")
	async activate(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.recurringExpensesService.activateByType(id, profile.id, "SUBSCRIPTION");
	}

	@Delete(":id/permanent")
	@ApiOperation({
		summary: "Permanently delete a subscription (hard delete — removes record)",
	})
	@ApiMessageResponse(200, "Subscription permanently deleted")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Recurring expense not found")
	@ApiErrorResponse(500, "Internal server error")
	async deletePermanent(@Param("id") id: string, @CurrentUser() profile: Profile) {
		await this.recurringExpensesService.deletePermanentByType(id, profile.id, "SUBSCRIPTION");
		return { message: "Subscription permanently deleted" };
	}
}
