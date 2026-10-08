import { Module } from "@nestjs/common";
import { CreditCalculationService } from "./calculations/credit-calculation.service";
import { CreditCardsController } from "./credit-cards.controller";
import { CreditCardsService } from "./credit-cards.service";

@Module({
	providers: [CreditCardsService, CreditCalculationService],
	controllers: [CreditCardsController],
	exports: [CreditCardsService, CreditCalculationService],
})
export class CreditCardsModule {}
