import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { toCents } from "../common/utils/money.util";
import type { Period } from "../common/utils/period.util";
import { computePeriodRange, PERIODS } from "../common/utils/period.util";
import { PrismaService } from "../prisma/prisma.service";
import type { BankKpis } from "./dto/bank.dto";
import { CreateBankDto, UpdateBankDto } from "./dto/bank.dto";

interface AccountWithLoan {
	id: string;
	balance: { toString(): string };
	type: string;
	loan?: { remaining: { toString(): string } } | null;
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
			withInfo?: boolean;
		},
	) {
		const sortBy = filters?.sortBy ?? "name";
		const order = filters?.order ?? "asc";
		const isActive = filters?.isActive === undefined ? true : filters.isActive;
		const withInfo = filters?.withInfo ?? false;

		if (!withInfo) {
			return this.prisma.bank.findMany({
				where: { profileId, isActive },
				orderBy: { [sortBy]: order },
			});
		}

		const banks = await this.prisma.bank.findMany({
			where: { profileId, isActive },
			orderBy: { [sortBy]: order },
			include: {
				accounts: {
					where: { isActive: true },
					include: { loan: true },
				},
			},
		});

		return banks.map((bank) => {
			const { accounts, ...bankData } = bank;
			return { ...bankData, info: this.computeBankKpis(accounts) };
		});
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
		return { ...bankData, info: this.computeBankKpis(accounts) };
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
			const cents = toCents(t.amount);
			if (t.type === "INCOME") {
				income += cents;
			} else if (t.type === "EXPENSE") {
				expenses += cents;
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
				const principalCents = toCents(loan.principal);
				const remainingCents = toCents(loan.remaining);
				const progress =
					principalCents > 0
						? Math.round(((principalCents - remainingCents) / principalCents) * 100)
						: 0;
				return {
					id: loan.id,
					accountId: loan.accountId,
					accountName: a.name,
					principal: principalCents,
					interestRate: Number(loan.interestRate),
					termMonths: loan.termMonths,
					startDate: loan.startDate.toISOString(),
					monthlyPayment: toCents(loan.monthlyPayment),
					remaining: remainingCents,
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
		let assets = 0;
		let liabilities = 0;

		for (const account of accounts) {
			const balanceCents = toCents(account.balance);

			if (balanceCents > 0) {
				assets += balanceCents;
			} else if (balanceCents < 0) {
				liabilities += Math.abs(balanceCents);
			}

			if (account.type === "DEBIT" || account.type === "CASH") {
				netWorth += balanceCents;
				if (balanceCents > 0) {
					liquidity += balanceCents;
				}
			} else if (account.type === "CREDIT") {
				netWorth += -Math.abs(balanceCents);
				debt += Math.abs(balanceCents);
			} else if (account.type === "LOAN") {
				const remainingCents = account.loan ? toCents(account.loan.remaining) : 0;
				netWorth += -remainingCents;
				debt += remainingCents;
				liabilities += remainingCents;
			}
		}

		return { netWorth, liquidity, debt, balanceBreakdown: { assets, liabilities } };
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
