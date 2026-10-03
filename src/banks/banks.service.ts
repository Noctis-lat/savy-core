import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { Period } from "../common/utils/period.util";
import { computePeriodRange, PERIODS } from "../common/utils/period.util";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { BankDetailKpis, BankKpis } from "./dto/bank.dto";
import { CreateBankDto, UpdateBankDto } from "./dto/bank.dto";

interface AccountWithLoan {
	balance: { toString(): string };
	type: string;
	loan?: { remaining: { toString(): string } } | null;
}

export interface BanksListResult {
	banks: Array<Record<string, unknown>>;
	info?: BankKpis;
	page: number;
	perPage: number;
	total: number;
	totalPages: number;
}

@Injectable()
export class BanksService {
	constructor(private readonly prisma: PrismaService) {}

	// ─── List ──────────────────────────────────────────────────────────

	async findAllByProfile(
		profileId: string,
		filters?: {
			isActive?: boolean;
			sortBy?: "name" | "createdAt";
			order?: "asc" | "desc";
			page?: number;
			perPage?: number;
			withInfo?: boolean;
			search?: string;
		},
	): Promise<BanksListResult> {
		const sortBy = filters?.sortBy ?? "name";
		const order = filters?.order ?? "asc";
		const isActive = filters?.isActive === undefined ? true : filters.isActive;
		const withInfo = filters?.withInfo ?? false;
		const page = filters?.page ?? 1;
		const perPage = filters?.perPage ?? 10;

		const where: Prisma.BankWhereInput = {
			profileId,
			isActive,
			...(filters?.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
		};

		const [banks, total] = await Promise.all([
			this.prisma.bank.findMany({
				where,
				orderBy: { [sortBy]: order },
				skip: (page - 1) * perPage,
				take: perPage,
			}),
			this.prisma.bank.count({ where }),
		]);

		const result: BanksListResult = {
			banks,
			page,
			perPage,
			total,
			totalPages: Math.ceil(total / perPage) || 1,
		};

		if (withInfo) {
			result.info = await this.computeGlobalBankInfo(profileId);
		}

		return result;
	}

	// ─── Detail ────────────────────────────────────────────────────────

	async findOne(id: string, profileId: string, withInfo = false) {
		if (!withInfo) {
			const bank = await this.prisma.bank.findFirst({
				where: { id, profileId },
			});
			if (!bank) {
				throw new NotFoundException("Bank not found");
			}
			return bank;
		}

		const bank = await this.prisma.bank.findFirst({
			where: { id, profileId },
			include: {
				accounts: {
					where: { isActive: true },
					include: { loan: true },
				},
			},
		});
		if (!bank) {
			throw new NotFoundException("Bank not found");
		}

		const { accounts, ...bankData } = bank;
		return { ...bankData, info: this.computeBankDetailKpis(accounts) };
	}

	// ─── Income vs Expenses ────────────────────────────────────────────

	async getIncomeVsExpenses(id: string, profileId: string, period: string) {
		if (!PERIODS.includes(period as Period)) {
			throw new UnprocessableEntityException("Invalid period value");
		}

		const bank = await this.prisma.bank.findFirst({
			where: { id, profileId },
			include: {
				accounts: {
					where: { isActive: true },
					select: { id: true },
				},
			},
		});
		if (!bank) {
			throw new NotFoundException("Bank not found");
		}

		const range = computePeriodRange(period);
		const accountIds = bank.accounts.map((a) => a.id);

		const transactions =
			accountIds.length > 0
				? await this.prisma.transaction.findMany({
						where: {
							accountId: { in: accountIds },
							type: { in: ["INCOME", "EXPENSE"] },
							date: { gte: range.start, lte: range.end },
						},
						select: { type: true, amount: true },
					})
				: [];

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

	// ─── Sub-resources by bank ─────────────────────────────────────────

	async findAccountsByBank(bankId: string, profileId: string) {
		await this.findOneBasic(bankId, profileId);
		return this.prisma.account.findMany({
			where: { bankId, profileId, isActive: true },
			orderBy: { createdAt: "desc" },
		});
	}

	async findCreditCardsByBank(bankId: string, profileId: string) {
		await this.findOneBasic(bankId, profileId);
		const accounts = await this.prisma.account.findMany({
			where: { bankId, profileId, type: "CREDIT", isActive: true },
			include: { creditCard: true },
			orderBy: { createdAt: "desc" },
		});
		return accounts
			.filter((a) => a.creditCard)
			.map((a) => ({
				...a.creditCard!,
				accountName: a.name,
				accountId: a.id,
				balance: a.balance,
			}));
	}

	async findLoansByBank(bankId: string, profileId: string) {
		await this.findOneBasic(bankId, profileId);
		const accounts = await this.prisma.account.findMany({
			where: { bankId, profileId, type: "LOAN", isActive: true },
			include: { loan: true },
			orderBy: { createdAt: "desc" },
		});
		return accounts
			.filter((a) => a.loan)
			.map((a) => {
				const loan = a.loan!;
				const principal = Number(loan.principal);
				const remaining = Number(loan.remaining);
				const progress =
					principal > 0 ? Math.round(((principal - remaining) / principal) * 100) : 0;
				return {
					id: loan.id,
					accountId: loan.accountId,
					accountName: a.name,
					principal,
					interestRate: Number(loan.interestRate),
					termMonths: loan.termMonths,
					startDate: loan.startDate.toISOString(),
					monthlyPayment: Number(loan.monthlyPayment),
					remaining,
					progress,
					createdAt: loan.createdAt.toISOString(),
					updatedAt: loan.updatedAt.toISOString(),
				};
			});
	}

	// ─── CRUD ──────────────────────────────────────────────────────────

	async create(profileId: string, dto: CreateBankDto) {
		return this.prisma.bank.create({
			data: {
				profileId,
				name: dto.name,
				color: dto.color,
				logo: dto.logo,
			},
		});
	}

	async update(id: string, profileId: string, dto: UpdateBankDto) {
		await this.findOneBasic(id, profileId);
		return this.prisma.bank.update({
			where: { id },
			data: dto,
		});
	}

	async remove(id: string, profileId: string): Promise<void> {
		await this.findOneBasic(id, profileId);
		await this.prisma.bank.update({
			where: { id },
			data: { isActive: false },
		});
	}

	// ─── Private helpers ───────────────────────────────────────────────

	private computeBankKpis(accounts: AccountWithLoan[]): BankKpis {
		let netWorth = 0;
		let liquidity = 0;
		let debt = 0;

		for (const account of accounts) {
			const balance = Number(account.balance);

			if (account.type === "DEBIT" || account.type === "CASH") {
				netWorth += balance;
				if (balance > 0) {
					liquidity += balance;
				}
			} else if (account.type === "CREDIT") {
				netWorth += -Math.abs(balance);
				debt += Math.abs(balance);
			} else if (account.type === "LOAN") {
				const remaining = account.loan ? Number(account.loan.remaining) : 0;
				netWorth += -remaining;
				debt += remaining;
			}
		}

		return { netWorth, liquidity, debt };
	}

	private computeBankDetailKpis(accounts: AccountWithLoan[]): BankDetailKpis {
		let assets = 0;
		let liabilities = 0;
		const base = this.computeBankKpis(accounts);

		for (const account of accounts) {
			const balance = Number(account.balance);

			if (balance > 0) {
				assets += balance;
			} else if (balance < 0) {
				liabilities += Math.abs(balance);
			}

			if (account.type === "LOAN" && account.loan) {
				liabilities += Number(account.loan.remaining);
			}
		}

		return { ...base, balanceBreakdown: { assets, liabilities } };
	}

	/**
	 * Global financial summary across ALL active accounts that belong to ANY bank for the profile.
	 * Ignores pagination/search filters — always reflects the full bank-linked financial picture.
	 */
	private async computeGlobalBankInfo(profileId: string): Promise<BankKpis> {
		const accounts = await this.prisma.account.findMany({
			where: { profileId, isActive: true, bankId: { not: null } },
			select: { type: true, balance: true, loan: { select: { remaining: true } } },
		});

		return this.computeBankKpis(accounts);
	}

	private async findOneBasic(id: string, profileId: string) {
		const bank = await this.prisma.bank.findFirst({
			where: { id, profileId },
		});
		if (!bank) {
			throw new NotFoundException("Bank not found");
		}
		return bank;
	}
}
