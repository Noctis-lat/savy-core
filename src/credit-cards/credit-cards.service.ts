import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Account, CreditCard } from "../generated/prisma/client";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { calculatePaymentDueDays } from "./calculations/payment-due-days.util";
import { CreateCreditCardDto, UpdateCreditCardDto } from "./dto/credit-card.dto";

const Decimal = Prisma.Decimal;

/** Response shape with computed fields (availableCredit, currentBalance, nextPaymentDueDate). */
export interface CreditCardWithComputed extends CreditCard {
	availableCredit: number;
	currentBalance: number;
	nextPaymentDueDate: Date | null;
}

/** Aggregated info across all credit cards for a profile. */
export interface CreditCardInfo {
	totalAvailableCredit: number;
	totalNoInterestPayment: number;
	totalMinPayment: number;
	totalDebt: number;
	total: number;
}

export interface CreditCardPaginatedResult {
	data: CreditCardWithComputed[];
	info: CreditCardInfo;
	page: number;
	perPage: number;
	total: number;
	totalPages: number;
}

@Injectable()
export class CreditCardsService {
	constructor(private readonly prisma: PrismaService) {}

	async findAllByProfile(
		profileId: string,
		filters?: {
			sortBy?: "createdAt" | "creditLimit";
			order?: "asc" | "desc";
			page?: number;
			perPage?: number;
			search?: string;
			isActive?: boolean;
			bankId?: string;
			hasUnpaidStatement?: boolean;
		},
	): Promise<CreditCardPaginatedResult> {
		const sortBy = filters?.sortBy ?? "createdAt";
		const order = filters?.order ?? "desc";
		const page = filters?.page ?? 1;
		const perPage = filters?.perPage ?? 10;

		const where = {
			...(filters?.search
				? { name: { contains: filters.search, mode: "insensitive" as const } }
				: {}),
			account: {
				profileId,
				...(filters?.isActive !== undefined ? { isActive: filters.isActive } : {}),
				...(filters?.bankId ? { bankId: filters.bankId } : {}),
			},
			...(filters?.hasUnpaidStatement === true
				? { statements: { some: { isPaid: false } } }
				: filters?.hasUnpaidStatement === false
					? { statements: { none: { isPaid: false } } }
					: {}),
		};

		const cards = await this.prisma.creditCard.findMany({
			where,
			include: { account: true },
			orderBy: { [sortBy]: order },
		});

		const total = cards.length;

		if (total === 0) {
			return {
				data: [],
				info: {
					totalAvailableCredit: 0,
					totalNoInterestPayment: 0,
					totalMinPayment: 0,
					totalDebt: 0,
					total: 0,
				},
				page,
				perPage,
				total: 0,
				totalPages: 1,
			};
		}

		// Batch-fetch latest unpaid statement per card (eliminates N+1)
		const cardIds = cards.map((c) => c.id);
		const unpaidStatements = await this.prisma.cardStatement.findMany({
			where: { creditCardId: { in: cardIds }, isPaid: false },
			orderBy: { periodEnd: "desc" },
			select: {
				creditCardId: true,
				paymentDueDate: true,
				noInterestPayment: true,
				minPayment: true,
			},
		});

		// Keep only the latest unpaid statement per card (already ordered by periodEnd desc)
		const latestUnpaidByCard = new Map<string, (typeof unpaidStatements)[number]>();
		for (const stmt of unpaidStatements) {
			if (!latestUnpaidByCard.has(stmt.creditCardId)) {
				latestUnpaidByCard.set(stmt.creditCardId, stmt);
			}
		}

		const cardsWithAccount = cards as unknown as Array<CreditCard & { account: Account }>;

		// Compute info from ALL cards
		let totalAvailableCredit = 0;
		let totalDebt = 0;
		let totalNoInterestPayment = 0;
		let totalMinPayment = 0;

		for (const c of cardsWithAccount) {
			const creditLimit = new Decimal(c.creditLimit.toString());
			const balance = new Decimal(c.account.balance.toString());
			totalAvailableCredit += creditLimit.sub(balance).toDecimalPlaces(2).toNumber();
			totalDebt += balance.toDecimalPlaces(2).toNumber();
			const stmt = latestUnpaidByCard.get(c.id);
			if (stmt) {
				totalNoInterestPayment += Number(stmt.noInterestPayment);
				totalMinPayment += Number(stmt.minPayment);
			}
		}

		// Paginate
		const start = (page - 1) * perPage;
		const pageCards = cardsWithAccount.slice(start, start + perPage);
		const data = pageCards.map((c) =>
			this.toResponseDto(c, c.account, latestUnpaidByCard.get(c.id) ?? null),
		);

		return {
			data,
			info: {
				totalAvailableCredit,
				totalNoInterestPayment,
				totalMinPayment,
				totalDebt,
				total,
			},
			page,
			perPage,
			total,
			totalPages: Math.ceil(total / perPage) || 1,
		};
	}

	async findOne(id: string, profileId: string): Promise<CreditCardWithComputed> {
		const card = await this.prisma.creditCard.findFirst({
			where: { id, account: { profileId } },
			include: { account: true },
		});
		if (!card) {
			throw new NotFoundException("Credit card not found");
		}

		const latestUnpaid = await this.prisma.cardStatement.findFirst({
			where: { creditCardId: card.id, isPaid: false },
			orderBy: { periodEnd: "desc" },
			select: { paymentDueDate: true, noInterestPayment: true, minPayment: true },
		});

		return this.toResponseDto(
			card as unknown as CreditCard & { account: Account },
			card.account,
			latestUnpaid,
		);
	}

	async create(profileId: string, dto: CreateCreditCardDto): Promise<CreditCard> {
		const account = await this.validateAccount(dto.accountId, profileId);

		const existing = await this.prisma.creditCard.findUnique({
			where: { accountId: dto.accountId },
			select: { id: true },
		});
		if (existing) {
			throw new BadRequestException("This account already has a credit card associated");
		}

		// Entity-superior: the card takes its identity from the account once, then owns it.
		// paymentDay is converted to the paymentDueDays offset and not persisted.
		return this.prisma.creditCard.create({
			data: {
				accountId: dto.accountId,
				name: account.name,
				color: account.color,
				icon: account.icon,
				creditLimit: dto.creditLimit,
				cutDay: dto.cutDay,
				paymentDueDays: calculatePaymentDueDays(dto.cutDay, dto.paymentDay),
				interestRate: dto.interestRate,
			},
		});
	}

	async update(id: string, profileId: string, dto: UpdateCreditCardDto): Promise<CreditCard> {
		const existing = await this.findOne(id, profileId);
		const { paymentDay, name, color, icon, ...rest } = dto;

		const data: Prisma.CreditCardUpdateInput = { ...rest };
		// paymentDay recomputes the offset; a cut-day-only change keeps the offset as-is.
		if (paymentDay !== undefined) {
			data.paymentDueDays = calculatePaymentDueDays(dto.cutDay ?? existing.cutDay, paymentDay);
		}

		const identity = {
			...(name !== undefined ? { name } : {}),
			...(color !== undefined ? { color } : {}),
			...(icon !== undefined ? { icon } : {}),
		};
		if (Object.keys(identity).length === 0) {
			return this.prisma.creditCard.update({ where: { id }, data });
		}

		// Entity-superior: identity changes sync one-way card -> account, atomically.
		return this.prisma.$transaction(async (tx) => {
			const card = await tx.creditCard.update({ where: { id }, data: { ...data, ...identity } });
			await tx.account.update({ where: { id: existing.accountId }, data: identity });
			return card;
		});
	}

	async remove(id: string, profileId: string): Promise<void> {
		await this.findOne(id, profileId);
		await this.prisma.creditCard.delete({ where: { id } });
	}

	/**
	 * Maps a CreditCard + its Account to the response DTO with computed fields.
	 * - availableCredit = creditLimit - account.balance (number, 2dp)
	 * - currentBalance = account.balance (number, 2dp)
	 * - nextPaymentDueDate = latest unpaid statement's paymentDueDate (null if none)
	 *
	 * Accepts a pre-fetched statement to avoid N+1 queries in list endpoints.
	 */
	private toResponseDto(
		card: CreditCard,
		account: Account,
		latestUnpaid: {
			paymentDueDate: Date | null;
			noInterestPayment: Prisma.Decimal;
			minPayment: Prisma.Decimal;
		} | null,
	): CreditCardWithComputed {
		const creditLimit = new Decimal(card.creditLimit.toString());
		const balance = new Decimal(account.balance.toString());
		const availableCredit = creditLimit.sub(balance).toDecimalPlaces(2);

		return {
			...card,
			availableCredit: availableCredit.toNumber(),
			currentBalance: balance.toDecimalPlaces(2).toNumber(),
			nextPaymentDueDate: latestUnpaid?.paymentDueDate ?? null,
		};
	}

	private async validateAccount(
		accountId: string,
		profileId: string,
	): Promise<Pick<Account, "id" | "type" | "name" | "color" | "icon">> {
		const account = await this.prisma.account.findFirst({
			where: { id: accountId, profileId },
			select: { id: true, type: true, name: true, color: true, icon: true },
		});
		if (!account) {
			throw new NotFoundException("Account not found");
		}
		if (account.type !== "CREDIT") {
			throw new BadRequestException("Account must be of type CREDIT");
		}
		return account;
	}
}
