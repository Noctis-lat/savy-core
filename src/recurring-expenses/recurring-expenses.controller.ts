import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator";
import {
	ApiArraySuccessResponse,
	ApiErrorResponse,
	ApiMessageResponse,
	ApiSuccessResponse,
} from "../common/decorators/api-response.decorator";
import type { Profile } from "../generated/prisma/client";
import {
	CreateRecurringExpenseDto,
	QueryRecurringExpensesDto,
	RecurringExpenseResponseDto,
	UpdateRecurringExpenseDto,
} from "./dto/recurring-expense.dto";
import { RecurringExpensesService } from "./recurring-expenses.service";

@ApiTags("recurring-expenses")
@ApiBearerAuth()
@Controller("recurring-expenses")
export class RecurringExpensesController {
	constructor(private readonly recurringExpensesService: RecurringExpensesService) {}

	@Get()
	@ApiOperation({
		summary: "List all recurring expenses for the current user with optional filters",
	})
	@ApiArraySuccessResponse(200, RecurringExpenseResponseDto, "Returns array of recurring expenses")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(500, "Internal server error")
	async findAll(@CurrentUser() profile: Profile, @Query() query: QueryRecurringExpensesDto) {
		return this.recurringExpensesService.findAllByProfile(profile.id, {
			type: query.type,
			isActive: query.isActive === undefined ? undefined : query.isActive === "true",
			sortBy: query.sortBy,
			order: query.order,
		});
	}

	@Get(":id")
	@ApiOperation({ summary: "Get a single recurring expense by ID" })
	@ApiSuccessResponse(200, RecurringExpenseResponseDto, "Returns the recurring expense")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Recurring expense not found")
	@ApiErrorResponse(500, "Internal server error")
	async findOne(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.recurringExpensesService.findOne(id, profile.id);
	}

	@Post()
	@ApiOperation({ summary: "Create a new recurring expense" })
	@ApiSuccessResponse(201, RecurringExpenseResponseDto, "Returns the created recurring expense")
	@ApiErrorResponse(400, "Validation error or invalid request data")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(500, "Internal server error")
	async create(@CurrentUser() profile: Profile, @Body() dto: CreateRecurringExpenseDto) {
		return this.recurringExpensesService.create(profile.id, dto);
	}

	@Patch(":id")
	@ApiOperation({ summary: "Update a recurring expense by ID" })
	@ApiSuccessResponse(200, RecurringExpenseResponseDto, "Returns the updated recurring expense")
	@ApiErrorResponse(400, "Validation error or invalid request data")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Recurring expense not found")
	@ApiErrorResponse(500, "Internal server error")
	async update(
		@Param("id") id: string,
		@CurrentUser() profile: Profile,
		@Body() dto: UpdateRecurringExpenseDto,
	) {
		return this.recurringExpensesService.update(id, profile.id, dto);
	}

	@Delete(":id")
	@ApiOperation({
		summary: "Cancel a recurring expense (soft delete — deactivates but keeps history)",
	})
	@ApiMessageResponse(200, "Recurring expense cancelled")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Recurring expense not found")
	@ApiErrorResponse(500, "Internal server error")
	async cancel(@Param("id") id: string, @CurrentUser() profile: Profile) {
		await this.recurringExpensesService.cancel(id, profile.id);
		return { message: "Recurring expense cancelled" };
	}

	@Delete(":id/permanent")
	@ApiOperation({
		summary: "Permanently delete a recurring expense (hard delete — removes record)",
	})
	@ApiMessageResponse(200, "Recurring expense permanently deleted")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Recurring expense not found")
	@ApiErrorResponse(500, "Internal server error")
	async deletePermanent(@Param("id") id: string, @CurrentUser() profile: Profile) {
		await this.recurringExpensesService.deletePermanent(id, profile.id);
		return { message: "Recurring expense permanently deleted" };
	}
}
