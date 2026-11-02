import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Account, CreditCard } from "../generated/prisma/client";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreditCalculationService } from "./calculations/credit-calculation.service";
import { calculatePaymentDueDays, nextCutDate } from "./calculations/payment-due-days.util";
import { CreateCreditCardDto, UpdateCreditCardDto } from "./dto/credit-card.dto";

const Decimal = Prisma.Decimal;

/** Response shape with computed fields (availableCredit, currentBalance, cycle dates). */
export interface CreditCardWithComputed extends Omit<CreditCard, "paymentDay"> {
	paymentAccount?: Account | null;
	availableCredit: number;
	currentBalance: number;
	nextPaymentDueDate: Date | null;
	currentCycleCutDate: Date;
	currentCyclePaymentDueDate: Date;
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
	constructor(
		private readonly prisma: PrismaService,
		private readonly calculationService: CreditCalculationService,
	) {}

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
			include: { account: true, paymentAccount: true },
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

		const cardsWithAccount = cards as unknown as Array<
			CreditCard & { account: Account; paymentAccount: Account | null }
		>;

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
			include: { account: true, paymentAccount: true },
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

	async create(profileId: string, dto: CreateCreditCardDto): Promise<CreditCardWithComputed> {
		const account = await this.validateAccount(dto.accountId, profileId);

		const existing = await this.prisma.creditCard.findUnique({
			where: { accountId: dto.accountId },
			select: { id: true },
		});
		if (existing) {
			throw new BadRequestException("This account already has a credit card associated");
		}

		if (dto.paymentAccountId) {
			await this.validatePaymentAccount(dto.paymentAccountId, profileId, dto.accountId);
		}

		// Entity-superior: the card takes its identity from the account once, then owns it.
		// paymentDay is converted to the paymentDueDays offset and not persisted.
		const card = await this.prisma.creditCard.create({
			data: {
				accountId: dto.accountId,
				name: account.name,
				color: account.color,
				icon: account.icon,
				creditLimit: dto.creditLimit,
				cutDay: dto.cutDay,
				paymentDueDays: calculatePaymentDueDays(dto.cutDay, dto.paymentDay),
				interestRate: dto.interestRate,
				...(dto.paymentAccountId ? { paymentAccountId: dto.paymentAccountId } : {}),
			},
			include: { account: true, paymentAccount: true },
		});

		return this.toResponseDto(card, card.account, null);
	}

	async update(
		id: string,
		profileId: string,
		dto: UpdateCreditCardDto,
	): Promise<CreditCardWithComputed> {
		const existing = await this.findOne(id, profileId);
		const { paymentDay, name, color, icon, paymentAccountId, ...rest } = dto;

		const data: Prisma.CreditCardUpdateInput = { ...rest };
		// paymentDay recomputes the offset; a cut-day-only change keeps the offset as-is.
		if (paymentDay !== undefined) {
			data.paymentDueDays = calculatePaymentDueDays(dto.cutDay ?? existing.cutDay, paymentDay);
		}
		// paymentAccountId: null clears it, a string sets it (with ownership validation)
		if (paymentAccountId !== undefined) {
			if (paymentAccountId === null) {
				data.paymentAccount = { disconnect: true };
			} else {
				await this.validatePaymentAccount(paymentAccountId, profileId, existing.accountId);
				data.paymentAccount = { connect: { id: paymentAccountId } };
			}
		}

		const identity = {
			...(name !== undefined ? { name } : {}),
			...(color !== undefined ? { color } : {}),
			...(icon !== undefined ? { icon } : {}),
		};

		let updated: CreditCard & { account: Account; paymentAccount: Account | null };
		if (Object.keys(identity).length === 0) {
			updated = await this.prisma.creditCard.update({
				where: { id },
				data,
				include: { account: true, paymentAccount: true },
			});
		} else {
			// Entity-superior: identity changes sync one-way card -> account, atomically.
			updated = await this.prisma.$transaction(async (tx) => {
				const card = await tx.creditCard.update({
					where: { id },
					data: { ...data, ...identity },
					include: { account: true, paymentAccount: true },
				});
				await tx.account.update({ where: { id: existing.accountId }, data: identity });
				return card;
			});
		}

		const latestUnpaid = await this.prisma.cardStatement.findFirst({
			where: { creditCardId: id, isPaid: false },
			orderBy: { periodEnd: "desc" },
			select: { paymentDueDate: true, noInterestPayment: true, minPayment: true },
		});

		return this.toResponseDto(updated, updated.account, latestUnpaid);
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
	 * - currentCycleCutDate = next upcoming cut date from cutDay (always present)
	 * - currentCyclePaymentDueDate = cutDate + paymentDueDays, adjusted to next business day
	 *
	 * Accepts a pre-fetched statement to avoid N+1 queries in list endpoints.
	 */
	private toResponseDto(
		card: CreditCard & { paymentAccount?: Account | null },
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

		const cutDate = nextCutDate(card.cutDay);
		const paymentDueDate = this.calculationService.calculatePaymentDueDate(
			cutDate,
			card.paymentDueDays ?? 20,
		);

		// paymentDay is a legacy column — strip it from the response
		const { paymentDay: _paymentDay, ...cardWithoutLegacy } = card;

		return {
			...cardWithoutLegacy,
			availableCredit: availableCredit.toNumber(),
			currentBalance: balance.toDecimalPlaces(2).toNumber(),
			nextPaymentDueDate: latestUnpaid?.paymentDueDate ?? null,
			currentCycleCutDate: cutDate,
			currentCyclePaymentDueDate: paymentDueDate,
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

	/**
	 * Validates that a payment account belongs to the profile and is not the card's
	 * own account (you can't pay a credit card with itself).
	 */
	private async validatePaymentAccount(
		paymentAccountId: string,
		profileId: string,
		cardAccountId: string,
	): Promise<void> {
		if (paymentAccountId === cardAccountId) {
			throw new BadRequestException("Payment account cannot be the same as the card account");
		}
		const account = await this.prisma.account.findFirst({
			where: { id: paymentAccountId, profileId },
			select: { id: true },
		});
		if (!account) {
			throw new NotFoundException("Payment account not found");
		}
	}
}
