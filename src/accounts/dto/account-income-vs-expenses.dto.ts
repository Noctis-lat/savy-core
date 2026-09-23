import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";
import { PERIODS } from "../../common/utils/period.util";

export class QueryAccountIncomeVsExpensesDto {
	@ApiPropertyOptional({
		enum: PERIODS,
		default: "month",
		description: "Aggregation period. Defaults to month if omitted.",
	})
	@IsOptional()
	@IsString()
	period?: string;
}

export class AccountIncomeVsExpensesResponseDto {
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
		example: "2026-09",
		description: "Period identifier (depends on selected period)",
	})
	period!: string;

	@ApiProperty({
		example: "Septiembre 2026",
		description: "Human-readable period label",
	})
	periodLabel!: string;
}
