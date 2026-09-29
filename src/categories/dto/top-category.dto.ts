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

export class TopCategoryItemDto {
	@ApiProperty({ example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", description: "Category ID" })
	id!: string;

	@ApiProperty({ example: "profile-uuid", description: "Owner profile ID" })
	profileId!: string;

	@ApiProperty({ example: "Groceries", description: "Category display name" })
	name!: string;

	@ApiProperty({ example: "EXPENSE", description: "Category type" })
	type!: string;

	@ApiPropertyOptional({ example: "#22c55e", description: "UI color" })
	color!: string | null;

	@ApiPropertyOptional({ example: "shopping-cart", description: "Icon identifier" })
	icon!: string | null;

	@ApiProperty({ example: "2026-07-28T07:06:12.000Z", description: "Creation date" })
	createdAt!: Date;

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

export class TopCategoriesResponseDto {
	@ApiProperty({
		example: 3200000,
		description: "Total expenses across all categories in scope, in integer cents",
	})
	totalExpenses!: number;

	@ApiProperty({ type: [TopCategoryItemDto], description: "Top categories ranked by amount" })
	categories!: TopCategoryItemDto[];
}
