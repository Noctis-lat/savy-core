import { Injectable, NotFoundException } from "@nestjs/common";
import type { CardStatement, Transaction } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateCardStatementDto } from "./dto/card-statement.dto";
import {
	buildInstallmentDetail,
	type InstallmentDetail,
	type InstallmentPlanForDetail,
} from "./installment-billing.util";

/** A statement transaction; INSTALLMENT rows carry their plan summary. */
export type StatementTransaction = Transaction & { installment: InstallmentDetail | null };

@Injectable()
export class CardStatementsService {
	constructor(private readonly prisma: PrismaService) {}

	async findAllByProfile(
		profileId: string,
		filters?: {
			creditCardId?: string;
			isPaid?: boolean;
			sortBy?: "periodEnd" | "balance" | "createdAt";
			order?: "asc" | "desc";
		},
	): Promise<CardStatement[]> {
		const sortBy = filters?.sortBy ?? "createdAt";
		const order = filters?.order ?? "desc";
		return this.prisma.cardStatement.findMany({
			where: {
				creditCard: {
					account: { profileId },
				},
				...(filters?.creditCardId ? { creditCardId: filters.creditCardId } : {}),
				...(filters?.isPaid !== undefined ? { isPaid: filters.isPaid } : {}),
			},
			orderBy: { [sortBy]: order },
		});
	}

	async findOne(id: string, profileId: string): Promise<CardStatement> {
		const statement = await this.prisma.cardStatement.findFirst({
			where: {
				id,
				creditCard: { account: { profileId } },
			},
		});
		if (!statement) {
			throw new NotFoundException("Card statement not found");
		}
		return statement;
	}

	/**
	 * Returns the transactions that compose a statement (installments, purchases,
	 * payments, commissions and interest charges), linked via Transaction.statementId
	 * at generation time.
	 *
	 * INSTALLMENT rows come first (by installment number, then date) and include an
	 * `installment` summary of their plan; every other row follows chronologically
	 * with `installment: null`. Plans, purchases and installment history are loaded
	 * in a single batch query (no N+1).
	 */
	async findTransactions(id: string, profileId: string): Promise<StatementTransaction[]> {
		await this.findOne(id, profileId);
		const rows = await this.prisma.transaction.findMany({
			where: { statementId: id },
			orderBy: [{ date: "asc" }, { createdAt: "asc" }],
		});

		const installmentRows = rows.filter((r) => r.type === "INSTALLMENT");
		const otherRows = rows
			.filter((r) => r.type !== "INSTALLMENT")
			.map((r) => ({ ...r, installment: null }));
		if (installmentRows.length === 0) {
			return otherRows;
		}

		const plansById = await this.loadPlansForDetail(installmentRows);
		const detailed = installmentRows
			.map((r) => {
				const plan = r.installmentPlanId ? plansById.get(r.installmentPlanId) : undefined;
				return {
					...r,
					installment:
						plan && r.installmentNumber !== null
							? buildInstallmentDetail(r.installmentNumber, plan)
							: null,
				};
			})
			.sort(
				(a, b) =>
					(a.installmentNumber ?? 0) - (b.installmentNumber ?? 0) ||
					a.date.getTime() - b.date.getTime(),
			);

		return [...detailed, ...otherRows];
	}

	private async loadPlansForDetail(
		installmentRows: Transaction[],
	): Promise<Map<string, InstallmentPlanForDetail>> {
		const planIds = [
			...new Set(
				installmentRows
					.map((r) => r.installmentPlanId)
					.filter((planId): planId is string => planId !== null),
			),
		];
		const plans = await this.prisma.installmentPlan.findMany({
			where: { id: { in: planIds } },
			include: {
				transaction: { select: { id: true, description: true, amount: true, date: true } },
				installments: { select: { statement: { select: { isPaid: true } } } },
			},
		});
		return new Map(plans.map((p) => [p.id, p]));
	}

	async update(id: string, profileId: string, dto: UpdateCardStatementDto): Promise<CardStatement> {
		await this.findOne(id, profileId);
		return this.prisma.cardStatement.update({
			where: { id },
			data: dto,
		});
	}

	async remove(id: string, profileId: string): Promise<void> {
		await this.findOne(id, profileId);
		await this.prisma.cardStatement.delete({ where: { id } });
	}
}
