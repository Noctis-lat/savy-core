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
import { CategoriesService } from "./categories.service";
import {
	CategoryResponseDto,
	CreateCategoryDto,
	QueryCategoriesDto,
	UpdateCategoryDto,
} from "./dto/category.dto";
import { QueryTopCategoriesDto, TopCategoryResponseDto } from "./dto/top-category.dto";

@ApiTags("categories")
@ApiBearerAuth()
@Controller("categories")
export class CategoriesController {
	constructor(private readonly categoriesService: CategoriesService) {}

	@Get()
	@ApiOperation({ summary: "List all categories for the current user with optional filters" })
	@ApiArraySuccessResponse(200, CategoryResponseDto, "Returns array of categories")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(500, "Internal server error")
	async findAll(@CurrentUser() profile: Profile, @Query() query: QueryCategoriesDto) {
		return this.categoriesService.findAllByProfile(profile.id, {
			type: query.type,
			sortBy: query.sortBy,
			order: query.order,
		});
	}

	@Get("top/banks/:id")
	@ApiOperation({ summary: "Get top expense categories for a bank" })
	@ApiArraySuccessResponse(200, TopCategoryResponseDto, "Returns top categories by expense amount")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Bank not found")
	@ApiErrorResponse(500, "Internal server error")
	async findTopByBank(
		@Param("id") id: string,
		@CurrentUser() profile: Profile,
		@Query() query: QueryTopCategoriesDto,
	) {
		return this.categoriesService.findTopByBank(id, profile.id, query.limit ?? 5);
	}

	@Get("top/accounts/:id")
	@ApiOperation({ summary: "Get top expense categories for an account" })
	@ApiArraySuccessResponse(200, TopCategoryResponseDto, "Returns top categories by expense amount")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Account not found")
	@ApiErrorResponse(500, "Internal server error")
	async findTopByAccount(
		@Param("id") id: string,
		@CurrentUser() profile: Profile,
		@Query() query: QueryTopCategoriesDto,
	) {
		return this.categoriesService.findTopByAccount(id, profile.id, query.limit ?? 5);
	}

	@Get(":id")
	@ApiOperation({ summary: "Get a single category by ID" })
	@ApiSuccessResponse(200, CategoryResponseDto, "Returns the category")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Category not found")
	@ApiErrorResponse(500, "Internal server error")
	async findOne(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.categoriesService.findOne(id, profile.id);
	}

	@Post()
	@ApiOperation({ summary: "Create a new category" })
	@ApiSuccessResponse(201, CategoryResponseDto, "Returns the created category")
	@ApiErrorResponse(400, "Validation error or invalid request data")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(409, "Category with same name and type already exists")
	@ApiErrorResponse(500, "Internal server error")
	async create(@CurrentUser() profile: Profile, @Body() dto: CreateCategoryDto) {
		return this.categoriesService.create(profile.id, dto);
	}

	@Patch(":id")
	@ApiOperation({ summary: "Update a category by ID (type is immutable)" })
	@ApiSuccessResponse(200, CategoryResponseDto, "Returns the updated category")
	@ApiErrorResponse(400, "Validation error or invalid request data")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Category not found")
	@ApiErrorResponse(409, "Category name already exists for this type")
	@ApiErrorResponse(500, "Internal server error")
	async update(
		@Param("id") id: string,
		@CurrentUser() profile: Profile,
		@Body() dto: UpdateCategoryDto,
	) {
		return this.categoriesService.update(id, profile.id, dto);
	}

	@Delete(":id")
	@ApiOperation({
		summary: "Delete a category (transactions keep their data, categoryId becomes null)",
	})
	@ApiMessageResponse(200, "Category deleted")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Category not found")
	@ApiErrorResponse(500, "Internal server error")
	async remove(@Param("id") id: string, @CurrentUser() profile: Profile) {
		await this.categoriesService.remove(id, profile.id);
		return { message: "Category deleted" };
	}
}
