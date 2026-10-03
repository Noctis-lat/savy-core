import { Injectable } from "@nestjs/common";
import { BudgetsService } from "../budgets/budgets.service";
import type {
	Account,
	AccountType,
	CardStatement,
	CreditCard,
	IncomeFrequency,
	IncomeSource,
	Loan,
	Prisma,
	RecurringExpense,
	RecurringExpenseFrequency,
	SavingsGoal,
	Transaction,
} from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type {
	AccountDistribution,
	AccountDistributionType,
	ActiveBudget,
	BankSummary,
	CreditCardSummary,
	DashboardSummary,
	IncomeSourceSummary,
	IncomeSourcesSummary,
	LoanSummary,
	NetWorthSummary,
	RecurringExpenseSummary,
	RecurringExpensesSummary,
	SavingsGoalSummary,
} from "./dto/dashboard.dto";

const ASSET_TYPES: AccountType[] = ["DEBIT", "CASH"];
const LIABILITY_TYPES: AccountType[] = ["CREDIT", "LOAN"];

/** Multipliers to normalize income frequency to a monthly estimate. */
const MONTHLY_MULTIPLIER: Record<IncomeFrequency, number> = {
	WEEKLY: 4.33,
	BIWEEKLY: 2.17,
	MONTHLY: 1,
};

const RECURRING_MONTHLY_MULTIPLIER: Record<RecurringExpenseFrequency, number> = {
	WEEKLY: 4.33,
	BIWEEKLY: 2.17,
	MONTHLY: 1,
	YEARLY: 1 / 12,
};

@Injectable()
export class DashboardService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly budgetsService: BudgetsService,
	) {}

	async getSummary(profile: { id: string; currency: string }): Promise<DashboardSummary> {
		const profileId = profile.id;
		const currency = profile.currency;

		const [
			accounts,
			recentTransactions,
			budgetProgress,
			savingsGoals,
			creditCards,
			loans,
			banks,
			incomeSources,
			recurringExpenses,
		] = await Promise.all([
			this.prisma.account.findMany({
				where: { profileId, isActive: true },
			}),
			this.fetchRecentTransactions(profileId),
			this.budgetsService.getProgressForAll(profileId),
			this.prisma.savingsGoal.findMany({
				where: { profileId },
				include: { account: { select: { balance: true } } },
			}),
			this.prisma.creditCard.findMany({
				where: { account: { profileId } },
				include: {
					account: true,
					statements: { orderBy: { periodEnd: "desc" }, take: 1 },
				},
			}),
			this.prisma.loan.findMany({
				where: { account: { profileId } },
			}),
			this.prisma.bank.findMany({
				where: { profileId },
				include: { _count: { select: { accounts: true } } },
			}),
			this.prisma.incomeSource.findMany({
				where: { profileId, isActive: true },
				orderBy: { amount: "desc" },
			}),
			this.prisma.recurringExpense.findMany({
				where: { profileId, isActive: true },
				orderBy: { amount: "desc" },
			}),
		]);

		const netWorth = this.computeNetWorth(accounts, currency);
		const accountsDistribution = this.computeAccountsDistribution(accounts);
		const activeBudgets = this.computeActiveBudgets(budgetProgress);
		const savingsGoalsSummary = this.computeSavingsGoals(savingsGoals);
		const creditOverview = this.computeCreditOverview(creditCards);
		const loansSummary = this.computeLoans(loans);
		const banksSummary = this.computeBanks(banks);
		const incomeSourcesSummary = this.computeIncomeSources(incomeSources);
		const recurringExpensesSummary = this.computeRecurringExpenses(recurringExpenses);

		return {
			netWorth,
			accountsDistribution,
			recentTransactions,
			activeBudgets,
			savingsGoals: savingsGoalsSummary,
			creditOverview: { creditCards: creditOverview, loans: loansSummary },
			banks: banksSummary,
			incomeSources: incomeSourcesSummary,
			recurringExpenses: recurringExpensesSummary,
			generatedAt: new Date().toISOString(),
		};
	}

	private async fetchRecentTransactions(profileId: string): Promise<Transaction[]> {
		const accountIds = await this.prisma.account
			.findMany({ where: { profileId }, select: { id: true } })
			.then((rows) => rows.map((r) => r.id));

		if (accountIds.length === 0) {
			return [];
		}

		return this.prisma.transaction.findMany({
			where: { accountId: { in: accountIds } },
			orderBy: { date: "desc" },
			take: 5,
		});
	}

	private computeNetWorth(accounts: Account[], currency: string): NetWorthSummary {
		let assets = 0;
		let liabilities = 0;

		for (const account of accounts) {
			const balance = Number(account.balance);
			if (ASSET_TYPES.includes(account.type)) {
				assets += balance;
			} else if (LIABILITY_TYPES.includes(account.type)) {
				liabilities += Math.abs(balance);
			}
		}

		return {
			total: assets - liabilities,
			assets,
			liabilities,
			currency,
			monthDelta: null,
		};
	}

	private computeAccountsDistribution(accounts: Account[]): AccountDistribution[] {
		const groups = new Map<AccountDistributionType, { count: number; totalBalance: number }>();

		let absoluteTotal = 0;
		for (const account of accounts) {
			const absBalance = Math.abs(Number(account.balance));
			absoluteTotal += absBalance;

			const type = account.type as AccountDistributionType;
			const existing = groups.get(type);
			if (existing) {
				existing.count += 1;
				existing.totalBalance += absBalance;
			} else {
				groups.set(type, { count: 1, totalBalance: absBalance });
			}
		}

		const result: AccountDistribution[] = [];
		for (const [type, { count, totalBalance }] of groups) {
			const percentage = absoluteTotal > 0 ? Math.round((totalBalance / absoluteTotal) * 100) : 0;
			result.push({ type, count, totalBalance, percentage });
		}

		result.sort((a, b) => b.totalBalance - a.totalBalance);
		return result.slice(0, 4);
	}

	private computeActiveBudgets(
		progress: Array<{
			id: string;
			categoryName: string;
			spent: number;
			budget: number;
			remaining: number;
			percentage: number;
		}>,
	): ActiveBudget[] {
		return progress
			.map((p) => ({
				id: p.id,
				categoryName: p.categoryName,
				spent: p.spent,
				budget: p.budget,
				percentage: p.percentage,
				remaining: p.remaining,
			}))
			.sort((a, b) => b.percentage - a.percentage)
			.slice(0, 4);
	}

	private computeSavingsGoals(
		goals: Array<SavingsGoal & { account: { balance: Prisma.Decimal } }>,
	): SavingsGoalSummary[] {
		const mapped = goals.map((g) => {
			const currentAmount = Number(g.account.balance);
			const targetAmount = Number(g.targetAmount);
			const percentage = targetAmount > 0 ? Math.round((currentAmount / targetAmount) * 100) : 0;
			return {
				id: g.id,
				name: g.name,
				currentAmount,
				targetAmount,
				percentage,
				deadline: g.deadline ? g.deadline.toISOString() : null,
				isCompleted: currentAmount >= targetAmount,
			} satisfies SavingsGoalSummary;
		});

		mapped.sort((a, b) => {
			if (a.isCompleted !== b.isCompleted) {
				return a.isCompleted ? 1 : -1;
			}
			const aTime = a.deadline ? new Date(a.deadline).getTime() : Number.POSITIVE_INFINITY;
			const bTime = b.deadline ? new Date(b.deadline).getTime() : Number.POSITIVE_INFINITY;
			return aTime - bTime;
		});

		return mapped.slice(0, 4);
	}

	private computeCreditOverview(
		cards: Array<
			CreditCard & {
				account: Account;
				statements: CardStatement[];
			}
		>,
	): CreditCardSummary[] {
		return cards.map((card) => {
			const creditLimit = Number(card.creditLimit);
			const latest = card.statements[0];
			const used = latest ? Number(latest.balance) : Math.abs(Number(card.account.balance));
			const available = Math.max(0, creditLimit - used);

			const nextPaymentDue = latest && !latest.isPaid ? latest.periodEnd.toISOString() : null;
			const minPayment = latest ? Number(latest.minPayment) : null;

			return {
				id: card.id,
				creditLimit,
				available,
				nextPaymentDue,
				minPayment,
			};
		});
	}

	private computeLoans(loans: Loan[]): LoanSummary[] {
		return loans.map((loan) => ({
			id: loan.id,
			principal: Number(loan.principal),
			remaining: Number(loan.remaining),
			monthlyPayment: Number(loan.monthlyPayment),
			nextPaymentDue: null,
		}));
	}

	private computeBanks(
		banks: Array<{
			id: string;
			name: string;
			color: string | null;
			logo: string | null;
			_count: { accounts: number };
		}>,
	): BankSummary[] {
		return banks
			.map((b) => ({
				id: b.id,
				name: b.name,
				color: b.color,
				logo: b.logo,
				accountCount: b._count.accounts,
			}))
			.sort((a, b) => b.accountCount - a.accountCount);
	}

	private computeIncomeSources(sources: IncomeSource[]): IncomeSourcesSummary {
		const mapped: IncomeSourceSummary[] = sources.map((s) => ({
			id: s.id,
			name: s.name,
			amount: Number(s.amount),
			frequency: s.frequency,
			destinationAccountId: s.destinationAccountId,
		}));

		const estimatedMonthlyTotal = Math.round(
			mapped.reduce((acc, s) => acc + s.amount * MONTHLY_MULTIPLIER[s.frequency], 0),
		);

		return { sources: mapped, estimatedMonthlyTotal };
	}

	private computeRecurringExpenses(expenses: RecurringExpense[]): RecurringExpensesSummary {
		const mapped: RecurringExpenseSummary[] = expenses.map((e) => ({
			id: e.id,
			name: e.name,
			amount: Number(e.amount),
			frequency: e.frequency,
			type: e.type,
			accountId: e.accountId,
			url: e.url,
		}));

		const estimatedMonthlyTotal = Math.round(
			mapped.reduce((acc, e) => acc + e.amount * RECURRING_MONTHLY_MULTIPLIER[e.frequency], 0),
		);

		return { expenses: mapped, estimatedMonthlyTotal };
	}
}
