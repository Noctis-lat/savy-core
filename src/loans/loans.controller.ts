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
import { CreateLoanDto, LoanResponseDto, QueryLoansDto, UpdateLoanDto } from "./dto/loan.dto";
import { LoansService } from "./loans.service";

@ApiTags("loans")
@ApiBearerAuth()
@Controller("loans")
export class LoansController {
	constructor(private readonly loansService: LoansService) {}

	@Get()
	@ApiOperation({ summary: "List all loans for the current user with optional sort" })
	@ApiArraySuccessResponse(200, LoanResponseDto, "Returns array of loans")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(500, "Internal server error")
	async findAll(@CurrentUser() profile: Profile, @Query() query: QueryLoansDto) {
		return this.loansService.findAllByProfile(profile.id, {
			sortBy: query.sortBy,
			order: query.order,
		});
	}

	@Get(":id")
	@ApiOperation({ summary: "Get a single loan by ID" })
	@ApiSuccessResponse(200, LoanResponseDto, "Returns the loan")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Loan not found")
	@ApiErrorResponse(500, "Internal server error")
	async findOne(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.loansService.findOne(id, profile.id);
	}

	@Post()
	@ApiOperation({ summary: "Create loan details for a LOAN account" })
	@ApiSuccessResponse(201, LoanResponseDto, "Returns the created loan")
	@ApiErrorResponse(400, "Validation error or account must be LOAN type or already has a loan")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Account not found")
	@ApiErrorResponse(500, "Internal server error")
	async create(@CurrentUser() profile: Profile, @Body() dto: CreateLoanDto) {
		return this.loansService.create(profile.id, dto);
	}

	@Patch(":id")
	@ApiOperation({ summary: "Update a loan by ID" })
	@ApiSuccessResponse(200, LoanResponseDto, "Returns the updated loan")
	@ApiErrorResponse(400, "Validation error or invalid request data")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Loan not found")
	@ApiErrorResponse(500, "Internal server error")
	async update(
		@Param("id") id: string,
		@CurrentUser() profile: Profile,
		@Body() dto: UpdateLoanDto,
	) {
		return this.loansService.update(id, profile.id, dto);
	}

	@Delete(":id")
	@ApiOperation({
		summary: "Deactivate a loan (soft delete — keeps history, hides the loan and its account)",
	})
	@ApiMessageResponse(200, "Loan deactivated")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Loan not found")
	@ApiErrorResponse(500, "Internal server error")
	async remove(@Param("id") id: string, @CurrentUser() profile: Profile) {
		await this.loansService.remove(id, profile.id);
		return { message: "Loan deactivated" };
	}

	@Patch(":id/activate")
	@ApiOperation({ summary: "Reactivate a previously deactivated loan and its linked account" })
	@ApiSuccessResponse(200, LoanResponseDto, "Returns the reactivated loan")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Loan not found")
	@ApiErrorResponse(500, "Internal server error")
	async activate(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.loansService.activate(id, profile.id);
	}

	@Delete(":id/permanent")
	@ApiOperation({
		summary:
			"Permanently delete a loan and its account (hard delete — cascade removes transactions)",
	})
	@ApiMessageResponse(200, "Loan and its account permanently deleted")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Loan not found")
	@ApiErrorResponse(500, "Internal server error")
	async removePermanent(@Param("id") id: string, @CurrentUser() profile: Profile) {
		await this.loansService.removePermanent(id, profile.id);
		return { message: "Loan and its account permanently deleted" };
	}
}
