import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { IncomeGenerationService } from "./income-generation.service";

@Module({
	imports: [PrismaModule],
	providers: [IncomeGenerationService],
})
export class IncomeGenerationModule {}
