import { ConfigService } from "@nestjs/config";
import {
	BadRequestException,
	Injectable,
	NotFoundException,
	UnprocessableEntityException,
} from "@nestjs/common";
import type { Period } from "../common/utils/period.util";
import { computePeriodRange, PERIODS } from "../common/utils/period.util";
import { CreditCalculationService } from "../credit-cards/calculations/credit-calculation.service";
import { Prisma } from "../generated/prisma/client";
import type {
	Account,
	AccountType,
	Transaction,
	TransactionType,
} from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { TransactionsInfoDto } from "./dto/transaction.dto";
import { CreateTransactionDto, UpdateTransactionDto } from "./dto/transaction.dto";

/** Account types that represent money you HAVE (positive balance = asset). */
const ASSET_TYPES: AccountType[] = ["DEBIT", "CASH"];

/** Account types that represent money you OWE (positive balance = liability). */
const LIABILITY_TYPES: AccountType[] = ["CREDIT", "LOAN"];

@Injectable()
export class TransactionsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
		private readonly calculationService: CreditCalculationService,
	) {}

	async findAllByProfile(
		profileId: string,
		filters: {
			accountId?: string;
			type?: TransactionType;
			categoryId?: string;
			bankId?: string;
			search?: string;
			from?: Date;
			to?: Date;
			page?: number;
			limit?: number;
			sortBy?: "date" | "amount" | "createdAt";
			order?: "asc" | "desc";
			includeInfo?: boolean;
			period?: string;
		},
	): Promise<{
		data: Transaction[];
		info?: TransactionsInfoDto;
		total: number;
		page: number;
		limit: number;
		totalPages: number;
	}> {
		// Validate and resolve period (overrides from/to when provided)
		let from = filters.from;
		let to = filters.to;

		if (filters.period) {
			if (!PERIODS.includes(filters.period as Period)) {
				throw new UnprocessableEntityException("Invalid period value");
			}
			const range = computePeriodRange(filters.period);
			from = range.start;
			to = range.end;
		}

		const page = filters.page ?? 1;
		const limit = Math.min(filters.limit ?? 50, 100);
		const skip = (page - 1) * limit;
		const sortBy = filters.sortBy ?? "date";
		const order = filters.order ?? "desc";

		// Find all accounts owned by the profile (source or destination)
		const ownedAccountIds = await this.prisma.account
			.findMany({
				where: { profileId },
				select: { id: true },
			})
			.then((accounts) => accounts.map((a) => a.id));

		// If a bank filter is provided, intersect owned accounts with those of the bank
		let scopedAccountIds = ownedAccountIds;
		if (filters.bankId) {
			const bankAccountIds = await this.prisma.account
				.findMany({
					where: { profileId, bankId: filters.bankId },
					select: { id: true },
				})
				.then((accounts) => accounts.map((a) => a.id));
			scopedAccountIds = ownedAccountIds.filter((id) => bankAccountIds.includes(id));
		}

		const where: Prisma.TransactionWhereInput = {
			AND: [
				{
					OR: [
						{ accountId: { in: scopedAccountIds } },
						{ destinationAccountId: { in: scopedAccountIds } },
					],
				},
				filters.accountId
					? {
							OR: [{ accountId: filters.accountId }, { destinationAccountId: filters.accountId }],
						}
					: {},
				filters.type ? { type: filters.type } : {},
				filters.categoryId ? { categoryId: filters.categoryId } : {},
				filters.search ? { description: { contains: filters.search, mode: "insensitive" } } : {},
				from || to
					? {
							date: {
								...(from ? { gte: from } : {}),
								...(to ? { lte: to } : {}),
							},
						}
					: {},
			],
		};

		const promises: [
			Promise<Transaction[]>,
			Promise<number>,
			Promise<TransactionsInfoDto | undefined>,
		] = [
			this.prisma.transaction.findMany({
				where,
				skip,
				take: limit,
				orderBy: { [sortBy]: order },
			}),
			this.prisma.transaction.count({ where }),
			filters.includeInfo ? this.computeFinancialInfo(profileId) : Promise.resolve(undefined),
		];

		const [data, total, info] = await Promise.all(promises);

		const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

		const result: {
			data: Transaction[];
			info?: TransactionsInfoDto;
			total: number;
			page: number;
			limit: number;
			totalPages: number;
		} = { data, total, page, limit, totalPages };

		if (info) {
			result.info = info;
		}

		return result;
	}

	async findOne(id: string, profileId: string): Promise<Transaction> {
		const transaction = await this.prisma.transaction.findFirst({
			where: {
				id,
				OR: [{ account: { profileId } }, { destinationAccount: { profileId } }],
			},
		});
		if (!transaction) {
			throw new NotFoundException("Transaction not found");
		}
		return transaction;
	}

	async create(profileId: string, dto: CreateTransactionDto): Promise<Transaction> {
		return this.prisma.$transaction(async (tx) => {
			const account = await this.validateAccountOwnership(tx, dto.accountId, profileId);
			this.validateTypeRules(dto.type, dto.destinationAccountId);

			let destinationAccount: Account | null = null;
			if (dto.destinationAccountId) {
				destinationAccount = await this.validateAccountOwnership(
					tx,
					dto.destinationAccountId,
					profileId,
				);
				this.validateDestinationType(dto.type, destinationAccount.type);
			}

			await this.validateCategoryOwnership(tx, dto.categoryId, profileId, dto.type);

			// Over-limit validation: EXPENSE on CREDIT accounts (gated by feature flag)
			if (dto.type === "EXPENSE") {
				await this.validateOverLimit(tx, dto.accountId, dto.amount, account);
			}

			const transaction = await tx.transaction.create({
				data: {
					accountId: dto.accountId,
					destinationAccountId: dto.destinationAccountId ?? null,
					categoryId: dto.categoryId ?? null,
					type: dto.type,
					amount: dto.amount,
					description: dto.description,
					note: dto.note,
					date: dto.date ? new Date(dto.date) : new Date(),
					commissionType: dto.commissionType ?? null,
				},
			});

			// Installment plan creation (gated by feature flag)
			if (dto.msiMonths && dto.msiType) {
				await this.createInstallmentPlan(tx, transaction.id, dto);
			}

			await this.applyBalance(
				tx,
				dto.type,
				dto.accountId,
				dto.destinationAccountId ?? null,
				dto.amount,
				1,
			);

			return transaction;
		});
	}

	async update(id: string, profileId: string, dto: UpdateTransactionDto): Promise<Transaction> {
		return this.prisma.$transaction(async (tx) => {
			const existing = await this.findOne(id, profileId);

			// Reverse old balance effect
			await this.applyBalance(
				tx,
				existing.type,
				existing.accountId,
				existing.destinationAccountId,
				Number(existing.amount),
				-1,
			);

			// Build new values
			const accountId = dto.accountId ?? existing.accountId;
			const destinationAccountId =
				dto.destinationAccountId !== undefined
					? dto.destinationAccountId
					: existing.destinationAccountId;
			const type = dto.type ?? existing.type;
			const amount = dto.amount ?? Number(existing.amount);
			const categoryId = dto.categoryId !== undefined ? dto.categoryId : existing.categoryId;

			// Validate new values
			await this.validateAccountOwnership(tx, accountId, profileId);
			this.validateTypeRules(type, destinationAccountId);

			let destinationAccount: Account | null = null;
			if (destinationAccountId) {
				destinationAccount = await this.validateAccountOwnership(
					tx,
					destinationAccountId,
					profileId,
				);
				this.validateDestinationType(type, destinationAccount.type);
			}

			await this.validateCategoryOwnership(tx, categoryId, profileId, type);

			const updated = await tx.transaction.update({
				where: { id },
				data: {
					accountId,
					destinationAccountId,
					categoryId,
					type,
					amount,
					description: dto.description !== undefined ? dto.description : existing.description,
					note: dto.note !== undefined ? dto.note : existing.note,
					date: dto.date ? new Date(dto.date) : existing.date,
				},
			});

			// Apply new balance effect
			await this.applyBalance(tx, type, accountId, destinationAccountId, amount, 1);

			return updated;
		});
	}

	async remove(id: string, profileId: string): Promise<void> {
		return this.prisma.$transaction(async (tx) => {
			const transaction = await this.findOne(id, profileId);

			await this.applyBalance(
				tx,
				transaction.type,
				transaction.accountId,
				transaction.destinationAccountId,
				Number(transaction.amount),
				-1,
			);

			await tx.transaction.delete({ where: { id } });
		});
	}

	// ── Financial info ────────────────────────────────────────────────

	private async computeFinancialInfo(profileId: string): Promise<TransactionsInfoDto> {
		const aggregated = await this.prisma.account.groupBy({
			by: ["type"],
			where: { profileId, isActive: true },
			_sum: { balance: true },
		});

		const sumFor = (types: AccountType[]): number =>
			aggregated
				.filter((row) => types.includes(row.type))
				.reduce((acc, row) => acc + Number(row._sum.balance ?? 0), 0);

		const assets = sumFor(ASSET_TYPES);
		const liabilities = Math.abs(sumFor(LIABILITY_TYPES));

		return {
			netWorth: assets - liabilities,
			liquidity: assets,
			debt: liabilities,
		};
	}

	// ── Balance helpers ────────────────────────────────────────────────

	private async applyBalance(
		tx: Prisma.TransactionClient,
		type: TransactionType,
		accountId: string,
		destinationAccountId: string | null,
		amount: number,
		sign: 1 | -1,
	): Promise<void> {
		const delta = amount * sign;

		if (type === "INCOME") {
			await tx.account.update({
				where: { id: accountId },
				data: { balance: { increment: delta } },
			});
		} else if (type === "EXPENSE") {
			await tx.account.update({
				where: { id: accountId },
				data: { balance: { decrement: delta } },
			});
		} else if (type === "TRANSFER" || type === "PAYMENT") {
			await tx.account.update({
				where: { id: accountId },
				data: { balance: { decrement: delta } },
			});
			if (destinationAccountId) {
				await tx.account.update({
					where: { id: destinationAccountId },
					data: { balance: { increment: delta } },
				});
			}
		}
	}

	private validateTypeRules(type: TransactionType, destinationAccountId?: string | null): void {
		if ((type === "INCOME" || type === "EXPENSE") && destinationAccountId) {
			throw new BadRequestException(`destinationAccountId must be null for ${type} transactions`);
		}
		if ((type === "TRANSFER" || type === "PAYMENT") && !destinationAccountId) {
			throw new BadRequestException(`destinationAccountId is required for ${type} transactions`);
		}
	}

	private validateDestinationType(type: TransactionType, destType: string): void {
		if (type === "TRANSFER") {
			if (!["DEBIT", "CASH"].includes(destType)) {
				throw new BadRequestException(
					`TRANSFER destination must be DEBIT or CASH, got ${destType}`,
				);
			}
		} else if (type === "PAYMENT") {
			if (!["CREDIT", "LOAN"].includes(destType)) {
				throw new BadRequestException(
					`PAYMENT destination must be CREDIT or LOAN, got ${destType}`,
				);
			}
		}
	}

	private async validateAccountOwnership(
		tx: Prisma.TransactionClient,
		accountId: string,
		profileId: string,
	): Promise<Account> {
		const account = await tx.account.findFirst({
			where: { id: accountId, profileId },
		});
		if (!account) {
			throw new NotFoundException("Account not found");
		}
		return account;
	}

	private async validateCategoryOwnership(
		tx: Prisma.TransactionClient,
		categoryId: string | null | undefined,
		profileId: string,
		type: TransactionType,
	): Promise<void> {
		if (!categoryId) return;

		const category = await tx.category.findFirst({
			where: { id: categoryId, profileId },
		});
		if (!category) {
			throw new NotFoundException("Category not found");
		}

		const expectedType = type === "INCOME" ? "INCOME" : "EXPENSE";
		if (category.type !== expectedType) {
			throw new BadRequestException(
				`Category type ${category.type} does not match transaction type ${type}`,
			);
		}
	}

	// ── Credit card reactive behavior ────────────────────────────────────

	/**
	 * Validates that an EXPENSE on a CREDIT account does not exceed the
	 * credit limit plus tolerance. Skipped when the feature flag is off.
	 *
	 * Saldo a favor (negative balance) naturally reduces the effective debt:
	 * balance + amount is the check, and a negative balance means the result
	 * is lower.
	 */
	private async validateOverLimit(
		tx: Prisma.TransactionClient,
		accountId: string,
		amount: number,
		account: Account,
	): Promise<void> {
		if (!this.isReactiveEnabled()) {
			return;
		}

		if (account.type !== "CREDIT") {
			return;
		}

		const creditCard = await tx.creditCard.findFirst({
			where: { accountId },
		});
		if (!creditCard) {
			return;
		}

		const currentBalance = new Prisma.Decimal(account.balance);
		const creditLimit = new Prisma.Decimal(creditCard.creditLimit);
		const tolerance = new Prisma.Decimal(creditCard.overLimitTolerance);
		const txAmount = new Prisma.Decimal(amount);

		const resultingBalance = currentBalance.add(txAmount);
		const maxAllowed = creditLimit.add(tolerance);

		if (resultingBalance.gt(maxAllowed)) {
			throw new BadRequestException(
				`Transaction of ${amount} exceeds available credit. ` +
					`Current balance: ${currentBalance}, credit limit: ${creditLimit}, tolerance: ${tolerance}.`,
			);
		}
	}

	private isReactiveEnabled(): boolean {
		return this.configService.get<string>("CREDIT_CARD_REACTIVE_ENABLED") === "true";
	}

	/**
	 * Creates an InstallmentPlan linked to the transaction when msiMonths
	 * and msiType are provided. Gated by the feature flag.
	 *
	 * MSI: monthlyAmount = amount / msiMonths, interestRate = null
	 * MSCI: monthlyAmount via calculateMsciMonthlyAmount, interestRate = msiRate
	 *
	 * The full purchase amount still hits account.balance (credit consumed
	 * immediately) — this is the existing EXPENSE behavior, not changed here.
	 */
	private async createInstallmentPlan(
		tx: Prisma.TransactionClient,
		transactionId: string,
		dto: CreateTransactionDto,
	): Promise<void> {
		if (!this.isReactiveEnabled()) {
			return;
		}

		if (!dto.msiMonths || !dto.msiType) {
			return;
		}

		const principal = new Prisma.Decimal(dto.amount);
		let monthlyAmount: Prisma.Decimal;
		let interestRate: Prisma.Decimal | null;

		if (dto.msiType === "MSCI") {
			const rate = new Prisma.Decimal(dto.msiRate ?? 0);
			monthlyAmount = this.calculationService.calculateMsciMonthlyAmount(
				principal,
				rate,
				dto.msiMonths,
			);
			interestRate = rate;
		} else {
			monthlyAmount = principal.div(dto.msiMonths);
			interestRate = null;
		}

		await tx.installmentPlan.create({
			data: {
				transactionId,
				type: dto.msiType,
				totalMonths: dto.msiMonths,
				currentMonth: 0,
				monthlyAmount: monthlyAmount.toDecimalPlaces(2),
				interestRate: interestRate
					? interestRate.toDecimalPlaces(4)
					: null,
				status: "ACTIVE",
			},
		});
	}
}
