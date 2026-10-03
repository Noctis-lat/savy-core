import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
	RecurringExpense,
	RecurringExpenseFrequency,
	RecurringExpenseType,
} from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type {
	CreateRecurringExpenseDto,
	UpdateRecurringExpenseDto,
} from "./dto/recurring-expense.dto";

const BILLING_DAY_RULES: Record<
	RecurringExpenseFrequency,
	{ count: number; max: number; label: string }
> = {
	WEEKLY: { count: 1, max: 7, label: "weekday (1-7)" },
	BIWEEKLY: { count: 2, max: 31, label: "days of month (1-31)" },
	MONTHLY: { count: 1, max: 31, label: "day of month (1-31)" },
	YEARLY: { count: 1, max: 31, label: "day of month (1-31)" },
};

@Injectable()
export class RecurringExpensesService {
	constructor(private readonly prisma: PrismaService) {}

	async findAllByProfile(
		profileId: string,
		filters?: {
			type?: RecurringExpenseType;
			isActive?: boolean;
			sortBy?: "name" | "amount" | "createdAt";
			order?: "asc" | "desc";
		},
	): Promise<RecurringExpense[]> {
		const sortBy = filters?.sortBy ?? "createdAt";
		const order = filters?.order ?? "desc";
		const isActive = filters?.isActive === undefined ? true : filters.isActive;
		return this.prisma.recurringExpense.findMany({
			where: {
				profileId,
				isActive,
				...(filters?.type ? { type: filters.type } : {}),
			},
			orderBy: { [sortBy]: order },
		});
	}

	async findOne(id: string, profileId: string): Promise<RecurringExpense> {
		const expense = await this.prisma.recurringExpense.findFirst({
			where: { id, profileId },
		});
		if (!expense) {
			throw new NotFoundException("Recurring expense not found");
		}
		return expense;
	}

	async create(profileId: string, dto: CreateRecurringExpenseDto): Promise<RecurringExpense> {
		const billingErrors = this.validateBillingDays(dto.frequency, dto.billingDays);
		if (billingErrors.length > 0) {
			throw new BadRequestException(billingErrors);
		}

		await this.validateAccountOwnership(dto.accountId, profileId);

		if (dto.categoryId) {
			await this.validateCategoryOwnership(dto.categoryId, profileId);
		}

		return this.prisma.recurringExpense.create({
			data: {
				profileId,
				name: dto.name,
				amount: dto.amount,
				frequency: dto.frequency,
				billingDays: dto.billingDays,
				type: dto.type ?? "UNCLASSIFIED",
				accountId: dto.accountId,
				categoryId: dto.categoryId ?? null,
				url: dto.url ?? null,
				color: dto.color ?? null,
				icon: dto.icon ?? null,
			},
		});
	}

	async update(
		id: string,
		profileId: string,
		dto: UpdateRecurringExpenseDto,
	): Promise<RecurringExpense> {
		const existing = await this.findOne(id, profileId);

		const frequency = dto.frequency ?? existing.frequency;
		const billingDays = dto.billingDays ?? existing.billingDays;

		const billingErrors = this.validateBillingDays(frequency, billingDays);
		if (billingErrors.length > 0) {
			throw new BadRequestException(billingErrors);
		}

		if (dto.accountId) {
			await this.validateAccountOwnership(dto.accountId, profileId);
		}

		if (dto.categoryId) {
			await this.validateCategoryOwnership(dto.categoryId, profileId);
		}

		return this.prisma.recurringExpense.update({
			where: { id },
			data: dto,
		});
	}

	async cancel(id: string, profileId: string): Promise<void> {
		await this.findOne(id, profileId);
		await this.prisma.recurringExpense.update({
			where: { id },
			data: { isActive: false },
		});
	}

	async deletePermanent(id: string, profileId: string): Promise<void> {
		await this.findOne(id, profileId);
		await this.prisma.recurringExpense.delete({
			where: { id },
		});
	}

	private validateBillingDays(
		frequency: RecurringExpenseFrequency,
		billingDays: number[],
	): string[] {
		const errors: string[] = [];
		const rule = BILLING_DAY_RULES[frequency];

		if (billingDays.length !== rule.count) {
			errors.push(
				`billingDays must contain exactly ${rule.count} value(s) for ${frequency} frequency, got ${billingDays.length}`,
			);
		}

		for (const d of billingDays) {
			if (d < 1 || d > rule.max) {
				errors.push(`billing day ${d} is out of range (1-${rule.max}) for ${frequency} frequency`);
			}
		}

		return errors;
	}

	private async validateAccountOwnership(accountId: string, profileId: string): Promise<void> {
		const account = await this.prisma.account.findFirst({
			where: { id: accountId, profileId },
			select: { id: true },
		});
		if (!account) {
			throw new NotFoundException("Account not found or does not belong to the user");
		}
	}

	private async validateCategoryOwnership(categoryId: string, profileId: string): Promise<void> {
		const category = await this.prisma.category.findFirst({
			where: { id: categoryId, profileId },
			select: { id: true },
		});
		if (!category) {
			throw new NotFoundException("Category not found or does not belong to the user");
		}
	}
}
