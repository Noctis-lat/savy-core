import { Module } from "@nestjs/common";
import { RecurringExpensesController } from "./recurring-expenses.controller";
import { RecurringExpensesService } from "./recurring-expenses.service";

@Module({
	providers: [RecurringExpensesService],
	controllers: [RecurringExpensesController],
	exports: [RecurringExpensesService],
})
export class RecurringExpensesModule {}
