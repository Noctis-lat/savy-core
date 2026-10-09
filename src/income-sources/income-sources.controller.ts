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
	BulkCreateResponseDto,
	CreateIncomeSourceDto,
	IncomeSourceResponseDto,
	QueryIncomeSourcesDto,
	UpdateIncomeSourceDto,
} from "./dto/income-source.dto";
import { IncomeSourcesService } from "./income-sources.service";

@ApiTags("income-sources")
@ApiBearerAuth()
@Controller("income-sources")
export class IncomeSourcesController {
	constructor(private readonly incomeSourcesService: IncomeSourcesService) {}

	@Get()
	@ApiOperation({ summary: "List all income sources for the current user with optional filters" })
	@ApiArraySuccessResponse(200, IncomeSourceResponseDto, "Returns array of income sources")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(500, "Internal server error")
	async findAll(@CurrentUser() profile: Profile, @Query() query: QueryIncomeSourcesDto) {
		return this.incomeSourcesService.findAllByProfile(profile.id, {
			isActive: query.isActive === undefined ? undefined : query.isActive === "true",
			sortBy: query.sortBy,
			order: query.order,
		});
	}

	@Get(":id")
	@ApiOperation({ summary: "Get a single income source by ID" })
	@ApiSuccessResponse(200, IncomeSourceResponseDto, "Returns the income source")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Income source not found")
	@ApiErrorResponse(500, "Internal server error")
	async findOne(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.incomeSourcesService.findOne(id, profile.id);
	}

	@Post()
	@ApiOperation({ summary: "Create a new income source" })
	@ApiSuccessResponse(201, IncomeSourceResponseDto, "Returns the created income source")
	@ApiErrorResponse(400, "Validation error or invalid request data")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(500, "Internal server error")
	async create(@CurrentUser() profile: Profile, @Body() dto: CreateIncomeSourceDto) {
		return this.incomeSourcesService.create(profile.id, dto);
	}

	@Post("bulk")
	@ApiOperation({
		summary: "Create multiple income sources (per-item validation, partial success allowed)",
	})
	@ApiSuccessResponse(
		201,
		BulkCreateResponseDto,
		"Returns successful items, failed items with errors, total count, and creationState",
	)
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(500, "Internal server error")
	async bulkCreate(@CurrentUser() profile: Profile, @Body() body: { sources?: unknown[] }) {
		const sources = Array.isArray(body?.sources) ? body.sources : [];
		return this.incomeSourcesService.bulkCreate(profile.id, sources as Record<string, unknown>[]);
	}

	@Patch(":id")
	@ApiOperation({ summary: "Update an income source by ID" })
	@ApiSuccessResponse(200, IncomeSourceResponseDto, "Returns the updated income source")
	@ApiErrorResponse(400, "Validation error or invalid request data")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Income source not found")
	@ApiErrorResponse(500, "Internal server error")
	async update(
		@Param("id") id: string,
		@CurrentUser() profile: Profile,
		@Body() dto: UpdateIncomeSourceDto,
	) {
		return this.incomeSourcesService.update(id, profile.id, dto);
	}

	@Patch(":id/deactivate")
	@ApiOperation({ summary: "Deactivate an income source (reversible)" })
	@ApiSuccessResponse(200, IncomeSourceResponseDto, "Returns the deactivated income source")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Income source not found")
	@ApiErrorResponse(500, "Internal server error")
	async deactivate(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.incomeSourcesService.deactivate(id, profile.id);
	}

	@Patch(":id/activate")
	@ApiOperation({ summary: "Activate a previously deactivated income source" })
	@ApiSuccessResponse(200, IncomeSourceResponseDto, "Returns the activated income source")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Income source not found")
	@ApiErrorResponse(500, "Internal server error")
	async activate(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.incomeSourcesService.activate(id, profile.id);
	}

	@Delete(":id")
	@ApiOperation({ summary: "Permanently delete an income source" })
	@ApiMessageResponse(200, "Income source deleted")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Income source not found")
	@ApiErrorResponse(500, "Internal server error")
	async remove(@Param("id") id: string, @CurrentUser() profile: Profile) {
		await this.incomeSourcesService.remove(id, profile.id);
		return { message: "Income source deleted" };
	}
}
