import {
	BadRequestException,
	Injectable,
	NotFoundException,
	UnprocessableEntityException,
} from "@nestjs/common";
import type { Period } from "../common/utils/period.util";
import { computePeriodRange, PERIODS } from "../common/utils/period.util";
import type {
	Account,
	AccountType,
	Prisma,
	Transaction,
	TransactionType,
} from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { AccountsInfoDto, CreateAccountDto, UpdateAccountDto } from "./dto/account.dto";

/** Aggregate filters applied to all active accounts (ignores page/type/bankId filters). */
const INFO_WHERE = (profileId: string): Prisma.AccountWhereInput => ({
	profileId,
	isActive: true,
});

/** Account types that represent money you HAVE (positive balance = asset). */
const ASSET_TYPES: AccountType[] = ["DEBIT", "CASH"];

/** Account types that represent money you OWE (positive balance = liability). */
const LIABILITY_TYPES: AccountType[] = ["CREDIT", "LOAN"];

export interface AccountGroup {
	key: string;
	title: string;
	accounts: Account[];
}

export interface AccountsListResult {
	accounts?: Account[];
	groupedAccounts?: AccountGroup[];
	info?: AccountsInfoDto;
	page: number;
	perPage: number;
	total: number;
	totalPages: number;
}

@Injectable()
export class AccountsService {
	constructor(private readonly prisma: PrismaService) {}

	async findAllByProfile(
		profileId: string,
		filters?: {
			type?: AccountType;
			bankId?: string;
			isActive?: boolean;
			sortBy?: "balance" | "name" | "createdAt";
			order?: "asc" | "desc";
			page?: number;
			perPage?: number;
			includeInfo?: boolean;
			search?: string;
			groupedBy?: "banks" | "types";
		},
	): Promise<AccountsListResult> {
		const sortBy = filters?.sortBy ?? "createdAt";
		const order = filters?.order ?? "desc";
		// Default to active accounts unless the caller explicitly requests inactive
		const isActive = filters?.isActive === undefined ? true : filters.isActive;
		const page = filters?.page ?? 1;
		const perPage = filters?.perPage ?? 10;
		const groupedBy = filters?.groupedBy;

		const where: Prisma.AccountWhereInput = {
			profileId,
			isActive,
			...(filters?.type ? { type: filters.type } : {}),
			...(filters?.bankId ? { bankId: filters.bankId } : {}),
			...(filters?.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
		};

		// Include bank relation when grouping by banks so we can resolve bank names
		const include =
			groupedBy === "banks" ? { bank: { select: { id: true, name: true } } } : undefined;

		const [accounts, total] = await Promise.all([
			this.prisma.account.findMany({
				where,
				orderBy: { [sortBy]: order },
				skip: (page - 1) * perPage,
				take: perPage,
				...(include ? { include } : {}),
			}),
			this.prisma.account.count({ where }),
		]);

		const result: AccountsListResult = {
			page,
			perPage,
			total,
			totalPages: Math.ceil(total / perPage) || 1,
		};

		if (groupedBy) {
			result.groupedAccounts = this.groupAccounts(accounts, groupedBy);
		} else {
			result.accounts = accounts;
		}

		if (filters?.includeInfo) {
			result.info = await this.computeFinancialInfo(profileId);
		}

		return result;
	}

	async findOne(id: string, profileId: string): Promise<Account> {
		const account = await this.prisma.account.findFirst({
			where: { id, profileId },
		});
		if (!account) {
			throw new NotFoundException("Account not found");
		}
		return account;
	}

	async create(profileId: string, dto: CreateAccountDto): Promise<Account> {
		if (dto.bankId) {
			await this.validateBankOwnership(dto.bankId, profileId);
		}

		const initialBalance = dto.balance ?? 0;

		// No opening balance — just create the account
		if (initialBalance === 0) {
			return this.prisma.account.create({
				data: {
					profileId,
					bankId: dto.bankId ?? null,
					name: dto.name,
					type: dto.type,
					currency: dto.currency ?? "MXN",
					balance: 0,
					color: dto.color,
					icon: dto.icon,
					isSavingGoal: dto.isSavingGoal ?? false,
				},
			});
		}

		// Create account + opening balance transaction atomically.
		// The transaction materializes the initial balance so that statement
		// generation can reconstruct startingBalance correctly (0 before the
		// transaction date, actual balance after). Without it, the system
		// treats the initial balance as if it existed for the entire first
		// period, inflating the average daily balance.
		//
		// Transaction type reflects the semantic meaning:
		// - Liability (CREDIT/LOAN) + positive balance → EXPENSE (debt you owed)
		// - Liability + negative balance (saldo a favor) → INCOME (credit)
		// - Asset (DEBIT/CASH) + positive balance → INCOME (money you had)
		// - Asset + negative balance (overdraft) → EXPENSE (money you owed)
		const isLiability = dto.type === "CREDIT" || dto.type === "LOAN";
		const openingType: TransactionType = isLiability
			? initialBalance > 0
				? "EXPENSE"
				: "INCOME"
			: initialBalance > 0
				? "INCOME"
				: "EXPENSE";

		return this.prisma.$transaction(async (tx) => {
			const account = await tx.account.create({
				data: {
					profileId,
					bankId: dto.bankId ?? null,
					name: dto.name,
					type: dto.type,
					currency: dto.currency ?? "MXN",
					balance: initialBalance,
					color: dto.color,
					icon: dto.icon,
					isSavingGoal: dto.isSavingGoal ?? false,
				},
			});

			await tx.transaction.create({
				data: {
					accountId: account.id,
					type: openingType,
					amount: Math.abs(initialBalance),
					description: "Opening balance",
					date: account.createdAt,
				},
			});

			return account;
		});
	}

	async update(id: string, profileId: string, dto: UpdateAccountDto): Promise<Account> {
		await this.findOne(id, profileId);
		await this.assertIdentityEditable(id, dto);

		if (dto.bankId) {
			await this.validateBankOwnership(dto.bankId, profileId);
		}

		return this.prisma.account.update({
			where: { id },
			data: dto,
		});
	}

	/**
	 * Entity-superior rule: an account backing a credit card, loan or savings goal is a
	 * logical resource. The entity owns name/color/icon and syncs them one-way to the
	 * account, so those fields cannot be edited on the account directly.
	 */
	private async assertIdentityEditable(id: string, dto: UpdateAccountDto): Promise<void> {
		if (dto.name === undefined && dto.color === undefined && dto.icon === undefined) {
			return;
		}

		const links = await this.prisma.account.findUnique({
			where: { id },
			select: {
				creditCard: { select: { id: true } },
				loan: { select: { id: true } },
				_count: { select: { savingsGoals: true } },
			},
		});
		if (!links) {
			return;
		}

		const owner = links.creditCard
			? "credit card"
			: links.loan
				? "loan"
				: links._count.savingsGoals > 0
					? "savings goal"
					: null;
		if (owner) {
			throw new BadRequestException(
				`This account is linked to a ${owner}; edit name, color and icon on the ${owner} instead`,
			);
		}
	}

	async remove(id: string, profileId: string): Promise<void> {
		await this.findOne(id, profileId);
		await this.prisma.account.update({
			where: { id },
			data: { isActive: false },
		});
	}

	// ─── Transactions by account ──────────────────────────────────────

	async findTransactions(
		id: string,
		profileId: string,
		filters: {
			type?: TransactionType;
			categoryId?: string;
			search?: string;
			from?: Date;
			to?: Date;
			page?: number;
			limit?: number;
			sortBy?: "date" | "amount" | "createdAt";
			order?: "asc" | "desc";
		},
	): Promise<{
		data: Transaction[];
		total: number;
		page: number;
		limit: number;
		totalPages: number;
	}> {
		await this.findOne(id, profileId);

		const page = filters.page ?? 1;
		const limit = Math.min(filters.limit ?? 50, 100);
		const skip = (page - 1) * limit;
		const sortBy = filters.sortBy ?? "date";
		const order = filters.order ?? "desc";

		const where: Prisma.TransactionWhereInput = {
			OR: [{ accountId: id }, { destinationAccountId: id }],
			...(filters.type ? { type: filters.type } : {}),
			...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
			...(filters.search ? { description: { contains: filters.search, mode: "insensitive" } } : {}),
			...(filters.from || filters.to
				? {
						date: {
							...(filters.from ? { gte: filters.from } : {}),
							...(filters.to ? { lte: filters.to } : {}),
						},
					}
				: {}),
		};

		const [data, total] = await Promise.all([
			this.prisma.transaction.findMany({
				where,
				skip,
				take: limit,
				orderBy: { [sortBy]: order },
			}),
			this.prisma.transaction.count({ where }),
		]);

		const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

		return { data, total, page, limit, totalPages };
	}

	// ─── Income vs Expenses by account ────────────────────────────────

	async getIncomeVsExpenses(id: string, profileId: string, period: string) {
		if (!PERIODS.includes(period as Period)) {
			throw new UnprocessableEntityException("Invalid period value");
		}

		await this.findOne(id, profileId);

		const range = computePeriodRange(period);

		const transactions = await this.prisma.transaction.findMany({
			where: {
				accountId: id,
				type: { in: ["INCOME", "EXPENSE"] },
				date: { gte: range.start, lte: range.end },
			},
			select: { type: true, amount: true },
		});

		let income = 0;
		let expenses = 0;

		for (const t of transactions) {
			const amount = Number(t.amount);
			if (t.type === "INCOME") {
				income += amount;
			} else if (t.type === "EXPENSE") {
				expenses += amount;
			}
		}

		return {
			income,
			expenses,
			period: range.label,
			periodLabel: range.periodLabel,
		};
	}

	/**
	 * Group a flat list of accounts by bank or type.
	 * Preserves the order accounts were fetched in (sort/pagination already applied).
	 */
	private groupAccounts(accounts: Account[], groupedBy: "banks" | "types"): AccountGroup[] {
		const map = new Map<string, AccountGroup>();

		for (const account of accounts) {
			let key: string;
			let title: string;

			if (groupedBy === "types") {
				key = account.type;
				title = account.type;
			} else {
				// groupedBy === "banks"
				const bank = (account as Account & { bank?: { id: string; name: string } | null }).bank;
				key = bank?.id ?? "none";
				title = bank?.name ?? "No bank";
			}

			let group = map.get(key);
			if (!group) {
				group = { key, title, accounts: [] };
				map.set(key, group);
			}
			group.accounts.push(account);
		}

		return Array.from(map.values());
	}

	/**
	 * Compute financial summary across ALL active accounts for the profile.
	 * Ignores page/type/bankId filters — always reflects the full financial picture.
	 *
	 * - assets:   sum of balances for DEBIT + CASH accounts
	 * - liabilities: sum of balances for CREDIT + LOAN accounts (positive value)
	 * - liquidity: same as assets (cash-equivalent accounts)
	 * - debt:     same as liabilities
	 * - netWorth: assets - liabilities
	 */
	private async computeFinancialInfo(profileId: string): Promise<AccountsInfoDto> {
		const aggregated = await this.prisma.account.groupBy({
			by: ["type"],
			where: INFO_WHERE(profileId),
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

	private async validateBankOwnership(bankId: string, profileId: string): Promise<void> {
		const bank = await this.prisma.bank.findFirst({
			where: { id: bankId, profileId },
			select: { id: true },
		});
		if (!bank) {
			throw new NotFoundException("Bank not found");
		}
	}
}
