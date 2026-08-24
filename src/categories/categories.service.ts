import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { toCents } from "../common/utils/money.util";
import type { Category, CategoryType } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCategoryDto, UpdateCategoryDto } from "./dto/category.dto";

@Injectable()
export class CategoriesService {
	constructor(private readonly prisma: PrismaService) {}

	async findAllByProfile(
		profileId: string,
		filters?: {
			type?: CategoryType;
			sortBy?: "name" | "createdAt";
			order?: "asc" | "desc";
		},
	): Promise<Category[]> {
		const sortBy = filters?.sortBy ?? "createdAt";
		const order = filters?.order ?? "desc";
		return this.prisma.category.findMany({
			where: { profileId, ...(filters?.type ? { type: filters.type } : {}) },
			orderBy: { [sortBy]: order },
		});
	}

	async findOne(id: string, profileId: string): Promise<Category> {
		const category = await this.prisma.category.findFirst({
			where: { id, profileId },
		});
		if (!category) {
			throw new NotFoundException("Category not found");
		}
		return category;
	}

	async create(profileId: string, dto: CreateCategoryDto): Promise<Category> {
		try {
			return await this.prisma.category.create({
				data: {
					profileId,
					name: dto.name,
					type: dto.type,
					color: dto.color,
					icon: dto.icon,
				},
			});
		} catch (error) {
			if (this.isUniqueConstraintError(error)) {
				throw new ConflictException(`Category "${dto.name}" with type ${dto.type} already exists`);
			}
			throw error;
		}
	}

	async update(id: string, profileId: string, dto: UpdateCategoryDto): Promise<Category> {
		await this.findOne(id, profileId);

		try {
			return await this.prisma.category.update({
				where: { id },
				data: dto,
			});
		} catch (error) {
			if (this.isUniqueConstraintError(error)) {
				throw new ConflictException(`Category "${dto.name}" already exists for this type`);
			}
			throw error;
		}
	}

	async remove(id: string, profileId: string): Promise<void> {
		await this.findOne(id, profileId);
		await this.prisma.category.delete({
			where: { id },
		});
	}

	// ─── Top categories ────────────────────────────────────────────────

	async findTopByBank(bankId: string, profileId: string, limit = 5) {
		// Validate bank ownership
		const bank = await this.prisma.bank.findFirst({
			where: { id: bankId, profileId },
		});
		if (!bank) {
			throw new NotFoundException("Bank not found");
		}

		const accounts = await this.prisma.account.findMany({
			where: { bankId, profileId, isActive: true },
			select: { id: true },
		});
		const accountIds = accounts.map((a) => a.id);

		return this.computeTopCategories(accountIds, limit);
	}

	async findTopByAccount(accountId: string, profileId: string, limit = 5) {
		// Validate account ownership
		const account = await this.prisma.account.findFirst({
			where: { id: accountId, profileId },
		});
		if (!account) {
			throw new NotFoundException("Account not found");
		}

		return this.computeTopCategories([accountId], limit);
	}

	private async computeTopCategories(accountIds: string[], limit: number) {
		if (accountIds.length === 0) {
			return [];
		}

		const transactions = await this.prisma.transaction.findMany({
			where: {
				accountId: { in: accountIds },
				type: "EXPENSE",
				categoryId: { not: null },
			},
			select: { amount: true, categoryId: true },
		});

		const categorySums = new Map<string, number>();
		let totalExpenses = 0;

		for (const t of transactions) {
			const cents = toCents(t.amount);
			totalExpenses += cents;
			if (t.categoryId) {
				categorySums.set(t.categoryId, (categorySums.get(t.categoryId) ?? 0) + cents);
			}
		}

		const topEntries = [...categorySums.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);

		const categoryIds = topEntries.map(([cid]) => cid);
		const categoryRows =
			categoryIds.length > 0
				? await this.prisma.category.findMany({
						where: { id: { in: categoryIds } },
						select: { id: true, name: true },
					})
				: [];
		const categoryNameById = new Map(categoryRows.map((c) => [c.id, c.name]));

		return topEntries.map(([categoryId, amount]) => ({
			categoryId,
			categoryName: categoryNameById.get(categoryId) ?? "Unknown",
			amount,
			percentage: totalExpenses > 0 ? Math.round((amount / totalExpenses) * 100) : 0,
		}));
	}

	private isUniqueConstraintError(error: unknown): boolean {
		return (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { code: string }).code === "P2002"
		);
	}
}
