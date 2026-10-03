import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import { AccountsModule } from "./accounts/accounts.module";
import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { BanksModule } from "./banks/banks.module";
import { BudgetsModule } from "./budgets/budgets.module";
import { CardStatementsModule } from "./card-statements/card-statements.module";
import { CategoriesModule } from "./categories/categories.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { ResponseInterceptor } from "./common/interceptors/response.interceptor";
import { CreditCardsModule } from "./credit-cards/credit-cards.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { IncomeSourcesModule } from "./income-sources/income-sources.module";
import { LoansModule } from "./loans/loans.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ProfilesModule } from "./profiles/profiles.module";
import { RecurringExpensesModule } from "./recurring-expenses/recurring-expenses.module";
import { SavingsGoalsModule } from "./savings-goals/savings-goals.module";
import { TransactionsModule } from "./transactions/transactions.module";

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
		}),
		LoggerModule.forRoot({
			pinoHttp: {
				transport:
					process.env.NODE_ENV !== "production"
						? { target: "pino-pretty", options: { colorize: true } }
						: undefined,
			},
		}),
		PrismaModule,
		AuthModule,
		ProfilesModule,
		AccountsModule,
		BanksModule,
		CategoriesModule,
		IncomeSourcesModule,
		TransactionsModule,
		SavingsGoalsModule,
		BudgetsModule,
		CreditCardsModule,
		CardStatementsModule,
		LoansModule,
		DashboardModule,
		RecurringExpensesModule,
	],
	providers: [
		{
			provide: APP_GUARD,
			useClass: JwtAuthGuard,
		},
		{
			provide: APP_INTERCEPTOR,
			useClass: ResponseInterceptor,
		},
		{
			provide: APP_FILTER,
			useClass: HttpExceptionFilter,
		},
	],
})
export class AppModule {}
