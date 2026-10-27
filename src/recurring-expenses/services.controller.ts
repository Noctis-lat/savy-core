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

@ApiTags("services")
@ApiBearerAuth()
@Controller("services")
export class ServicesController {
	constructor(private readonly recurringExpensesService: RecurringExpensesService) {}

	@Get()
	@ApiOperation({
		summary:
			"List services (recurring expenses of type SERVICE) with pagination, search and totals info",
	})
	@ApiSuccessResponse(
		200,
		RecurringByTypeListResponseDto,
		"Returns paginated services with totals info (count + sum of amounts)",
	)
	@ApiErrorResponse(400, "Invalid query parameters")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(500, "Internal server error")
	async findAll(@CurrentUser() profile: Profile, @Query() query: QueryRecurringByTypeDto) {
		return this.recurringExpensesService.findAllByType(profile.id, "SERVICE", {
			isActive: query.isActive === undefined ? undefined : query.isActive === "true",
			sortBy: query.sortBy,
			order: query.order,
			search: query.search,
			page: query.page,
			perPage: query.perPage,
		});
	}

	@Get(":id")
	@ApiOperation({ summary: "Get a single service by ID" })
	@ApiSuccessResponse(200, RecurringExpenseResponseDto, "Returns the service")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Recurring expense not found")
	@ApiErrorResponse(500, "Internal server error")
	async findOne(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.recurringExpensesService.findOneByType(id, profile.id, "SERVICE");
	}

	@Post()
	@ApiOperation({ summary: "Create a new service (recurring expense of type SERVICE)" })
	@ApiSuccessResponse(201, RecurringExpenseResponseDto, "Returns the created service")
	@ApiErrorResponse(400, "Validation error or invalid request data")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(500, "Internal server error")
	async create(@CurrentUser() profile: Profile, @Body() dto: CreateRecurringByTypeDto) {
		return this.recurringExpensesService.createByType(profile.id, "SERVICE", dto);
	}

	@Patch(":id")
	@ApiOperation({ summary: "Update a service by ID" })
	@ApiSuccessResponse(200, RecurringExpenseResponseDto, "Returns the updated service")
	@ApiErrorResponse(400, "Validation error or invalid request data")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Recurring expense not found")
	@ApiErrorResponse(500, "Internal server error")
	async update(
		@Param("id") id: string,
		@CurrentUser() profile: Profile,
		@Body() dto: UpdateRecurringByTypeDto,
	) {
		return this.recurringExpensesService.updateByType(id, profile.id, "SERVICE", dto);
	}

	@Delete(":id")
	@ApiOperation({
		summary: "Cancel a service (soft delete — deactivates but keeps history)",
	})
	@ApiMessageResponse(200, "Service cancelled")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Recurring expense not found")
	@ApiErrorResponse(500, "Internal server error")
	async cancel(@Param("id") id: string, @CurrentUser() profile: Profile) {
		await this.recurringExpensesService.cancelByType(id, profile.id, "SERVICE");
		return { message: "Service cancelled" };
	}

	@Delete(":id/permanent")
	@ApiOperation({
		summary: "Permanently delete a service (hard delete — removes record)",
	})
	@ApiMessageResponse(200, "Service permanently deleted")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Recurring expense not found")
	@ApiErrorResponse(500, "Internal server error")
	async deletePermanent(@Param("id") id: string, @CurrentUser() profile: Profile) {
		await this.recurringExpensesService.deletePermanentByType(id, profile.id, "SERVICE");
		return { message: "Service permanently deleted" };
	}
}
