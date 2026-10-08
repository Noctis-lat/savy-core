import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CardStatement } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCardStatementDto, UpdateCardStatementDto } from "./dto/card-statement.dto";

/** Fields that are generation-only when the reactive behavior is enabled. */
const GENERATION_ONLY_FIELDS = [
	"balance",
	"minPayment",
	"noInterestPayment",
	"interestAmount",
] as const;

@Injectable()
export class CardStatementsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
	) {}

	async findAllByProfile(
		profileId: string,
		filters?: {
			creditCardId?: string;
			isPaid?: boolean;
			sortBy?: "periodEnd" | "balance" | "createdAt";
			order?: "asc" | "desc";
		},
	): Promise<CardStatement[]> {
		const sortBy = filters?.sortBy ?? "createdAt";
		const order = filters?.order ?? "desc";
		return this.prisma.cardStatement.findMany({
			where: {
				creditCard: {
					account: { profileId },
				},
				...(filters?.creditCardId ? { creditCardId: filters.creditCardId } : {}),
				...(filters?.isPaid !== undefined ? { isPaid: filters.isPaid } : {}),
			},
			orderBy: { [sortBy]: order },
		});
	}

	async findOne(id: string, profileId: string): Promise<CardStatement> {
		const statement = await this.prisma.cardStatement.findFirst({
			where: {
				id,
				creditCard: { account: { profileId } },
			},
		});
		if (!statement) {
			throw new NotFoundException("Card statement not found");
		}
		return statement;
	}

	async create(profileId: string, dto: CreateCardStatementDto): Promise<CardStatement> {
		await this.validateCreditCard(dto.creditCardId, profileId);

		// When reactive behavior is enabled, calculated fields are generation-only
		if (this.isReactiveEnabled()) {
			const suppliedFields = GENERATION_ONLY_FIELDS.filter(
				(field) => dto[field] !== undefined && dto[field] !== null,
			);
			if (suppliedFields.length > 0) {
				throw new BadRequestException(
					`Fields ${suppliedFields.join(", ")} are generation-only when ` +
						`CREDIT_CARD_REACTIVE_ENABLED is true. Statements are auto-generated on read.`,
				);
			}
		}

		return this.prisma.cardStatement.create({
			data: {
				creditCardId: dto.creditCardId,
				periodStart: new Date(dto.periodStart),
				periodEnd: new Date(dto.periodEnd),
				balance: dto.balance,
				minPayment: dto.minPayment,
				noInterestPayment: dto.noInterestPayment,
				interestAmount: dto.interestAmount ?? 0,
			},
		});
	}

	async update(id: string, profileId: string, dto: UpdateCardStatementDto): Promise<CardStatement> {
		await this.findOne(id, profileId);
		return this.prisma.cardStatement.update({
			where: { id },
			data: dto,
		});
	}

	async remove(id: string, profileId: string): Promise<void> {
		await this.findOne(id, profileId);
		await this.prisma.cardStatement.delete({ where: { id } });
	}

	private async validateCreditCard(creditCardId: string, profileId: string): Promise<void> {
		const card = await this.prisma.creditCard.findFirst({
			where: { id: creditCardId, account: { profileId } },
			select: { id: true },
		});
		if (!card) {
			throw new NotFoundException("Credit card not found");
		}
	}

	private isReactiveEnabled(): boolean {
		return this.configService.get<string>("CREDIT_CARD_REACTIVE_ENABLED") === "true";
	}
}
