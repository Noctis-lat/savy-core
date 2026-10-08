import { Module } from "@nestjs/common";
import { CreditCardsModule } from "../credit-cards/credit-cards.module";
import { TransactionsController } from "./transactions.controller";
import { TransactionsService } from "./transactions.service";

@Module({
	imports: [CreditCardsModule],
	providers: [TransactionsService],
	controllers: [TransactionsController],
	exports: [TransactionsService],
})
export class TransactionsModule {}
