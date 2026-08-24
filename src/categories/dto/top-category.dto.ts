import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

export class QueryTopCategoriesDto {
	@ApiPropertyOptional({
		example: 5,
		default: 5,
		minimum: 1,
		maximum: 20,
		description: "Maximum number of categories to return. Defaults to 5.",
	})
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(20)
	limit?: number;
}

export class TopCategoryResponseDto {
	@ApiProperty({ example: "cat-uuid", description: "Category ID" })
	categoryId!: string;

	@ApiProperty({ example: "Groceries", description: "Category name" })
	categoryName!: string;

	@ApiProperty({
		example: 1500000,
		description: "Total amount spent in this category, in integer cents",
	})
	amount!: number;

	@ApiProperty({
		example: 47,
		description: "Percentage of total expenses (0-100), rounded",
	})
	percentage!: number;
}
