import { Module } from "@nestjs/common";
import { RecurringExpensesController } from "./recurring-expenses.controller";
import { RecurringExpensesService } from "./recurring-expenses.service";
import { ServicesController } from "./services.controller";
import { SubscriptionsController } from "./subscriptions.controller";

@Module({
	providers: [RecurringExpensesService],
	controllers: [RecurringExpensesController, ServicesController, SubscriptionsController],
	exports: [RecurringExpensesService],
})
export class RecurringExpensesModule {}
