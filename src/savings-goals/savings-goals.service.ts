import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, SavingsGoal } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateSavingsGoalDto, UpdateSavingsGoalDto } from "./dto/savings-goal.dto";

export interface SavingsGoalWithComputed extends Omit<SavingsGoal, "targetAmount"> {
	targetAmount: number;
	currentAmount: number;
	isCompleted: boolean;
}

export interface SavingsGoalsFilters {
	isCompleted?: boolean;
	sortBy?: "deadline" | "targetAmount" | "currentAmount";
	order?: "asc" | "desc";
	page?: number;
	perPage?: number;
	search?: string;
}

export interface SavingsGoalsInfo {
	/** Number of savings goals matching the active filters. */
	totalSavingsGoals: number;
	/** Sum of currentAmount (account balance) across all filtered goals. */
	totalSaved: number;
}

export interface SavingsGoalsListResult {
	savingsGoals: SavingsGoalWithComputed[];
	info: SavingsGoalsInfo;
	page: number;
	perPage: number;
	total: number;
	totalPages: number;
}

const VALID_ACCOUNT_TYPES = ["DEBIT", "CASH"];

@Injectable()
export class SavingsGoalsService {
	constructor(private readonly prisma: PrismaService) {}

	async findAllByProfile(
		profileId: string,
		filters?: SavingsGoalsFilters,
	): Promise<SavingsGoalsListResult> {
		const sortBy = filters?.sortBy ?? "deadline";
		const order = filters?.order ?? "asc";
		const page = filters?.page ?? 1;
		const perPage = filters?.perPage ?? 10;

		// isCompleted and currentAmount are computed from account.balance, so the
		// isCompleted filter and currentAmount sort cannot run at the DB layer.
		// We fetch every goal matching the DB-level filters (profileId + search),
		// then filter, sort and paginate in memory. info totals cover the filtered
		// set (after isCompleted, before pagination), mirroring budgets behaviour.
		const where: Prisma.SavingsGoalWhereInput = {
			profileId,
			...(filters?.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
		};

		const goals = await this.prisma.savingsGoal.findMany({
			where,
			include: { account: { select: { balance: true } } },
			orderBy:
				sortBy === "deadline" || sortBy === "targetAmount"
					? { [sortBy]: order }
					: { createdAt: "desc" },
		});

		let mapped = goals.map((g) => this.withComputed(g));

		if (filters?.isCompleted !== undefined) {
			mapped = mapped.filter((g) => g.isCompleted === filters.isCompleted);
		}

		if (sortBy === "currentAmount") {
			mapped.sort((a, b) => {
				const diff = a.currentAmount - b.currentAmount;
				return order === "asc" ? diff : -diff;
			});
		}

		const total = mapped.length;
		const totalPages = Math.ceil(total / perPage) || 1;
		const start = (page - 1) * perPage;
		const paged = mapped.slice(start, start + perPage);

		const info: SavingsGoalsInfo = {
			totalSavingsGoals: total,
			totalSaved: mapped.reduce((sum, g) => sum + g.currentAmount, 0),
		};

		return { savingsGoals: paged, info, page, perPage, total, totalPages };
	}

	async findOne(id: string, profileId: string): Promise<SavingsGoalWithComputed> {
		const goal = await this.prisma.savingsGoal.findFirst({
			where: { id, profileId },
			include: { account: { select: { balance: true } } },
		});
		if (!goal) {
			throw new NotFoundException("Savings goal not found");
		}
		return this.withComputed(goal);
	}

	async findByAccount(accountId: string, profileId: string): Promise<SavingsGoalWithComputed> {
		const goal = await this.prisma.savingsGoal.findFirst({
			where: { accountId, profileId },
			include: { account: { select: { balance: true } } },
		});
		if (!goal) {
			throw new NotFoundException("Savings goal not found for this account");
		}
		return this.withComputed(goal);
	}

	async create(profileId: string, dto: CreateSavingsGoalDto): Promise<SavingsGoalWithComputed> {
		// color and icon inherit from the linked account when the DTO omits them.
		// The frontend creates the account first, then the savings goal, so the goal
		// should mirror the account's visual identity unless explicitly overridden.
		const account = await this.validateAccount(dto.accountId, profileId);
		const identity = {
			name: dto.name,
			color: dto.color ?? account.color,
			icon: dto.icon ?? account.icon,
		};

		// Entity-superior: the goal is the source of truth for name/color/icon, so the
		// account is aligned to the goal's final identity in the same transaction.
		const goal = await this.prisma.$transaction(async (tx) => {
			const created = await tx.savingsGoal.create({
				data: {
					profileId,
					accountId: dto.accountId,
					...identity,
					targetAmount: dto.targetAmount,
					deadline: dto.deadline ? new Date(dto.deadline) : null,
				},
				include: { account: { select: { balance: true } } },
			});
			await tx.account.update({ where: { id: dto.accountId }, data: identity });
			return created;
		});
		return this.withComputed(goal);
	}

	async update(
		id: string,
		profileId: string,
		dto: UpdateSavingsGoalDto,
	): Promise<SavingsGoalWithComputed> {
		const existing = await this.prisma.savingsGoal.findFirst({
			where: { id, profileId },
		});
		if (!existing) {
			throw new NotFoundException("Savings goal not found");
		}

		if (dto.accountId) {
			await this.validateAccount(dto.accountId, profileId);
		}

		const accountId = dto.accountId ?? existing.accountId;
		const identity = {
			name: dto.name ?? existing.name,
			color: dto.color ?? existing.color,
			icon: dto.icon !== undefined ? dto.icon : existing.icon,
		};
		const data: Prisma.SavingsGoalUncheckedUpdateInput = {
			accountId,
			...identity,
			targetAmount: dto.targetAmount ?? existing.targetAmount,
			deadline:
				dto.deadline !== undefined
					? dto.deadline
						? new Date(dto.deadline)
						: null
					: existing.deadline,
		};
		const include = { account: { select: { balance: true } } } as const;

		const identityChanged =
			dto.name !== undefined ||
			dto.color !== undefined ||
			dto.icon !== undefined ||
			accountId !== existing.accountId;
		if (!identityChanged) {
			const goal = await this.prisma.savingsGoal.update({ where: { id }, data, include });
			return this.withComputed(goal);
		}

		// Entity-superior: sync the goal's identity one-way to its account, atomically.
		const goal = await this.prisma.$transaction(async (tx) => {
			const updated = await tx.savingsGoal.update({ where: { id }, data, include });
			await tx.account.update({ where: { id: accountId }, data: identity });
			return updated;
		});
		return this.withComputed(goal);
	}

	async remove(id: string, profileId: string): Promise<void> {
		const goal = await this.prisma.savingsGoal.findFirst({
			where: { id, profileId },
			select: { id: true, accountId: true },
		});
		if (!goal) {
			throw new NotFoundException("Savings goal not found");
		}
		// Entity-superior: deactivating the goal also clears the account's
		// isSavingGoal flag, so the account survives as a regular account and
		// keeps its balance. Both writes happen atomically.
		await this.prisma.$transaction(async (tx) => {
			await tx.savingsGoal.update({ where: { id }, data: { isActive: false } });
			await tx.account.update({
				where: { id: goal.accountId },
				data: { isSavingGoal: false },
			});
		});
	}

	async activate(id: string, profileId: string): Promise<SavingsGoalWithComputed> {
		const existing = await this.findOne(id, profileId);
		// Entity-superior: reactivating the goal also restores the account's
		// isSavingGoal flag atomically, mirroring the soft delete in reverse.
		await this.prisma.$transaction(async (tx) => {
			await tx.savingsGoal.update({ where: { id }, data: { isActive: true } });
			await tx.account.update({
				where: { id: existing.accountId },
				data: { isSavingGoal: true },
			});
		});
		return this.findOne(id, profileId);
	}

	async removePermanent(id: string, profileId: string): Promise<void> {
		const goal = await this.prisma.savingsGoal.findFirst({
			where: { id, profileId },
			select: { id: true, accountId: true },
		});
		if (!goal) {
			throw new NotFoundException("Savings goal not found");
		}
		// Cascade delete: removing the account cascades to the savings goal
		// (onDelete: Cascade on SavingsGoal.account) and to every transaction,
		// credit card, loan, income source and recurring expense tied to it.
		// The frontend creates one dedicated account per savings goal, so this
		// mirrors the 1:1 ownership the user expects.
		await this.prisma.account.delete({ where: { id: goal.accountId } });
	}

	private withComputed(
		goal: SavingsGoal & { account: { balance: unknown } },
	): SavingsGoalWithComputed {
		const currentAmount = Number(goal.account.balance);
		const targetAmount = Number(goal.targetAmount);
		return {
			id: goal.id,
			profileId: goal.profileId,
			accountId: goal.accountId,
			name: goal.name,
			targetAmount,
			deadline: goal.deadline,
			color: goal.color,
			icon: goal.icon,
			isActive: goal.isActive,
			currentAmount,
			isCompleted: currentAmount >= targetAmount,
			createdAt: goal.createdAt,
			updatedAt: goal.updatedAt,
		};
	}

	private async validateAccount(
		accountId: string,
		profileId: string,
	): Promise<{ id: string; color: string | null; icon: string | null }> {
		const account = await this.prisma.account.findFirst({
			where: { id: accountId, profileId },
			select: { id: true, type: true, color: true, icon: true },
		});
		if (!account) {
			throw new NotFoundException("Account not found");
		}
		if (!VALID_ACCOUNT_TYPES.includes(account.type)) {
			throw new BadRequestException(
				`Savings goal account must be DEBIT or CASH, got ${account.type}`,
			);
		}
		return { id: account.id, color: account.color, icon: account.icon };
	}
}
