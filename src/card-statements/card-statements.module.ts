import { Module } from "@nestjs/common";
import { CreditCardsModule } from "../credit-cards/credit-cards.module";
import { CardStatementsController } from "./card-statements.controller";
import { CardStatementsService } from "./card-statements.service";
import { StatementGenerationService } from "./statement-generation.service";

@Module({
	imports: [CreditCardsModule],
	providers: [CardStatementsService, StatementGenerationService],
	controllers: [CardStatementsController],
	exports: [CardStatementsService, StatementGenerationService],
})
export class CardStatementsModule {}
