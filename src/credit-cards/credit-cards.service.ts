import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Account, CreditCard } from "../generated/prisma/client";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCreditCardDto, UpdateCreditCardDto } from "./dto/credit-card.dto";

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

/** Response shape with computed fields (availableCredit, currentBalance, nextPaymentDueDate). */
export interface CreditCardWithComputed extends CreditCard {
	availableCredit: string;
	currentBalance: string;
	nextPaymentDueDate: Date | null;
}

@Injectable()
export class CreditCardsService {
	constructor(private readonly prisma: PrismaService) {}

	async findAllByProfile(
		profileId: string,
		filters?: {
			sortBy?: "createdAt" | "creditLimit";
			order?: "asc" | "desc";
		},
	): Promise<CreditCardWithComputed[]> {
		const sortBy = filters?.sortBy ?? "createdAt";
		const order = filters?.order ?? "desc";
		const cards = await this.prisma.creditCard.findMany({
			where: { account: { profileId } },
			include: { account: true },
			orderBy: { [sortBy]: order },
		});
		return Promise.all((cards as unknown as Array<CreditCard & { account: Account }>).map((c) => this.toResponseDto(c, c.account)));
	}

	async findOne(id: string, profileId: string): Promise<CreditCardWithComputed> {
		const card = await this.prisma.creditCard.findFirst({
			where: { id, account: { profileId } },
			include: { account: true },
		});
		if (!card) {
			throw new NotFoundException("Credit card not found");
		}
		return this.toResponseDto(card as unknown as CreditCard & { account: Account }, card.account);
	}

	async create(profileId: string, dto: CreateCreditCardDto): Promise<CreditCard> {
		await this.validateAccount(dto.accountId, profileId);

		const existing = await this.prisma.creditCard.findUnique({
			where: { accountId: dto.accountId },
			select: { id: true },
		});
		if (existing) {
			throw new BadRequestException("This account already has a credit card associated");
		}

		return this.prisma.creditCard.create({
			data: {
				accountId: dto.accountId,
				creditLimit: dto.creditLimit,
				cutDay: dto.cutDay,
				paymentDueDays: dto.paymentDueDays ?? 20,
				paymentDay: dto.paymentDay ?? null,
				overLimitTolerance: dto.overLimitTolerance ?? 0,
				interestRate: dto.interestRate,
				noInterestMonths: dto.noInterestMonths ?? 0,
			},
		});
	}

	async update(id: string, profileId: string, dto: UpdateCreditCardDto): Promise<CreditCard> {
		await this.findOne(id, profileId);
		return this.prisma.creditCard.update({
			where: { id },
			data: dto,
		});
	}

	async remove(id: string, profileId: string): Promise<void> {
		await this.findOne(id, profileId);
		await this.prisma.creditCard.delete({ where: { id } });
	}

	/**
	 * Maps a CreditCard + its Account to the response DTO with computed fields.
	 * - availableCredit = creditLimit - account.balance (Decimal, 2dp)
	 * - currentBalance = account.balance
	 * - nextPaymentDueDate = latest unpaid statement's paymentDueDate (null if none)
	 *
	 * NOT gated by feature flag — availableCredit is a pure read with no side effects.
	 */
	private async toResponseDto(
		card: CreditCard,
		account: Account,
	): Promise<CreditCardWithComputed> {
		const creditLimit = new Decimal(card.creditLimit.toString());
		const balance = new Decimal(account.balance.toString());
		const availableCredit = creditLimit.sub(balance).toDecimalPlaces(2);

		const latestUnpaid = await this.prisma.cardStatement.findFirst({
			where: { creditCardId: card.id, isPaid: false },
			orderBy: { periodEnd: "desc" },
			select: { paymentDueDate: true },
		});

		return {
			...card,
			availableCredit: availableCredit.toFixed(2),
			currentBalance: balance.toDecimalPlaces(2).toFixed(2),
			nextPaymentDueDate: latestUnpaid?.paymentDueDate ?? null,
		};
	}

	private async validateAccount(accountId: string, profileId: string): Promise<void> {
		const account = await this.prisma.account.findFirst({
			where: { id: accountId, profileId },
			select: { id: true, type: true },
		});
		if (!account) {
			throw new NotFoundException("Account not found");
		}
		if (account.type !== "CREDIT") {
			throw new BadRequestException("Account must be of type CREDIT");
		}
	}
}
