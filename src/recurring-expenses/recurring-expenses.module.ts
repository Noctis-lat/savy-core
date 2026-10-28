import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { RecurringExpenseGenerationService } from "./recurring-expense-generation.service";
import { RecurringExpensesController } from "./recurring-expenses.controller";
import { RecurringExpensesService } from "./recurring-expenses.service";
import { ServicesController } from "./services.controller";
import { SubscriptionsController } from "./subscriptions.controller";

@Module({
	imports: [PrismaModule],
	providers: [RecurringExpensesService, RecurringExpenseGenerationService],
	controllers: [RecurringExpensesController, ServicesController, SubscriptionsController],
	exports: [RecurringExpensesService],
})
export class RecurringExpensesModule {}
