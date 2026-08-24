import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";
import { BANK_PERIODS } from "../utils/period.util";

export class QueryIncomeVsExpensesDto {
	@ApiPropertyOptional({
		enum: BANK_PERIODS,
		default: "month",
		description: "Aggregation period. Defaults to month if omitted.",
	})
	@IsOptional()
	@IsString()
	period?: string;
}

export class IncomeVsExpensesResponseDto {
	@ApiProperty({
		example: 5000000,
		description: "Total income in the period, in integer cents",
	})
	income!: number;

	@ApiProperty({
		example: 3200000,
		description: "Total expenses in the period, in integer cents",
	})
	expenses!: number;

	@ApiProperty({
		example: "2026-07",
		description: "Period identifier (depends on selected period)",
	})
	period!: string;

	@ApiProperty({
		example: "Julio 2026",
		description: "Human-readable period label",
	})
	periodLabel!: string;
}
