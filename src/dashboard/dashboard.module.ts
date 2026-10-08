import { Module } from "@nestjs/common";
import { BudgetsModule } from "../budgets/budgets.module";
import { CardStatementsModule } from "../card-statements/card-statements.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";

@Module({
	imports: [BudgetsModule, CardStatementsModule],
	controllers: [DashboardController],
	providers: [DashboardService],
})
export class DashboardModule {}
