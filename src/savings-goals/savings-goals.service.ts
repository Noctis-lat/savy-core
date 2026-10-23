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

	async create(profileId: string, dto: CreateSavingsGoalDto): Promise<SavingsGoalWithComputed> {
		await this.validateAccount(dto.accountId, profileId);

		const goal = await this.prisma.savingsGoal.create({
			data: {
				profileId,
				accountId: dto.accountId,
				name: dto.name,
				targetAmount: dto.targetAmount,
				deadline: dto.deadline ? new Date(dto.deadline) : null,
				color: dto.color,
				icon: dto.icon,
			},
			include: { account: { select: { balance: true } } },
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

		const goal = await this.prisma.savingsGoal.update({
			where: { id },
			data: {
				accountId: dto.accountId ?? existing.accountId,
				name: dto.name ?? existing.name,
				targetAmount: dto.targetAmount ?? existing.targetAmount,
				deadline:
					dto.deadline !== undefined
						? dto.deadline
							? new Date(dto.deadline)
							: null
						: existing.deadline,
				color: dto.color ?? existing.color,
				icon: dto.icon !== undefined ? dto.icon : existing.icon,
			},
			include: { account: { select: { balance: true } } },
		});
		return this.withComputed(goal);
	}

	async remove(id: string, profileId: string): Promise<void> {
		const goal = await this.prisma.savingsGoal.findFirst({
			where: { id, profileId },
		});
		if (!goal) {
			throw new NotFoundException("Savings goal not found");
		}
		await this.prisma.savingsGoal.delete({ where: { id } });
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
			currentAmount,
			isCompleted: currentAmount >= targetAmount,
			createdAt: goal.createdAt,
			updatedAt: goal.updatedAt,
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
		if (!VALID_ACCOUNT_TYPES.includes(account.type)) {
			throw new BadRequestException(
				`Savings goal account must be DEBIT or CASH, got ${account.type}`,
			);
		}
	}
}
