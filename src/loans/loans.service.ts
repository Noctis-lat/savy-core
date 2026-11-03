import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Loan } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateLoanDto, UpdateLoanDto } from "./dto/loan.dto";

@Injectable()
export class LoansService {
	constructor(private readonly prisma: PrismaService) {}

	async findAllByProfile(
		profileId: string,
		filters?: {
			sortBy?: "createdAt" | "remaining" | "principal";
			order?: "asc" | "desc";
		},
	): Promise<Loan[]> {
		const sortBy = filters?.sortBy ?? "createdAt";
		const order = filters?.order ?? "desc";
		return this.prisma.loan.findMany({
			where: { account: { profileId } },
			orderBy: { [sortBy]: order },
		});
	}

	async findOne(id: string, profileId: string): Promise<Loan> {
		const loan = await this.prisma.loan.findFirst({
			where: { id, account: { profileId } },
		});
		if (!loan) {
			throw new NotFoundException("Loan not found");
		}
		return loan;
	}

	async create(profileId: string, dto: CreateLoanDto): Promise<Loan> {
		await this.validateAccount(dto.accountId, profileId);

		const existing = await this.prisma.loan.findUnique({
			where: { accountId: dto.accountId },
			select: { id: true },
		});
		if (existing) {
			throw new BadRequestException("This account already has a loan associated");
		}

		return this.prisma.loan.create({
			data: {
				accountId: dto.accountId,
				principal: dto.principal,
				interestRate: dto.interestRate,
				termMonths: dto.termMonths,
				startDate: new Date(dto.startDate),
				monthlyPayment: dto.monthlyPayment,
				remaining: dto.remaining ?? dto.principal,
			},
		});
	}

	async update(id: string, profileId: string, dto: UpdateLoanDto): Promise<Loan> {
		await this.findOne(id, profileId);
		return this.prisma.loan.update({
			where: { id },
			data: dto,
		});
	}

	async remove(id: string, profileId: string): Promise<void> {
		const loan = await this.prisma.loan.findFirst({
			where: { id, account: { profileId } },
			select: { id: true, accountId: true },
		});
		if (!loan) {
			throw new NotFoundException("Loan not found");
		}
		// Entity-superior: the loan controls its linked account. Deactivating the
		// loan also deactivates the account atomically, so the user's financial
		// picture stops including both, but the historical transactions remain.
		await this.prisma.$transaction(async (tx) => {
			await tx.loan.update({ where: { id }, data: { isActive: false } });
			await tx.account.update({ where: { id: loan.accountId }, data: { isActive: false } });
		});
	}

	async removePermanent(id: string, profileId: string): Promise<void> {
		const loan = await this.prisma.loan.findFirst({
			where: { id, account: { profileId } },
			select: { id: true, accountId: true },
		});
		if (!loan) {
			throw new NotFoundException("Loan not found");
		}
		// Cascade: deleting the account removes the loan and every transaction
		// that originated on it (onDelete: Cascade).
		await this.prisma.account.delete({ where: { id: loan.accountId } });
	}

	private async validateAccount(accountId: string, profileId: string): Promise<void> {
		const account = await this.prisma.account.findFirst({
			where: { id: accountId, profileId },
			select: { id: true, type: true },
		});
		if (!account) {
			throw new NotFoundException("Account not found");
		}
		if (account.type !== "LOAN") {
			throw new BadRequestException("Account must be of type LOAN");
		}
	}
}
