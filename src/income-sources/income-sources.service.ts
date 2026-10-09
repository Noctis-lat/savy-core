import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import type { AccountType, IncomeFrequency, IncomeSource } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
	CreateIncomeSourceDto,
	FailedIncomeSourceDto,
	UpdateIncomeSourceDto,
} from "./dto/income-source.dto";

export interface BulkCreateResult {
	creationState: "success" | "partial" | "failed";
	total: number;
	successful: IncomeSource[];
	failed: FailedIncomeSourceDto[];
}

const PAYDAY_RULES: Record<IncomeFrequency, { count: number; max: number; label: string }> = {
	WEEKLY: { count: 1, max: 7, label: "weekday (1-7)" },
	BIWEEKLY: { count: 2, max: 31, label: "days of month (1-31)" },
	MONTHLY: { count: 1, max: 31, label: "day of month (1-31)" },
};

const VALID_DESTINATION_TYPES: AccountType[] = ["DEBIT", "CASH"];

@Injectable()
export class IncomeSourcesService {
	constructor(private readonly prisma: PrismaService) {}

	async findAllByProfile(
		profileId: string,
		filters?: {
			isActive?: boolean;
			sortBy?: "name" | "amount" | "createdAt";
			order?: "asc" | "desc";
		},
	): Promise<IncomeSource[]> {
		const sortBy = filters?.sortBy ?? "createdAt";
		const order = filters?.order ?? "desc";
		const isActive = filters?.isActive === undefined ? true : filters.isActive;
		return this.prisma.incomeSource.findMany({
			where: { profileId, isActive },
			orderBy: { [sortBy]: order },
		});
	}

	async findOne(id: string, profileId: string): Promise<IncomeSource> {
		const source = await this.prisma.incomeSource.findFirst({
			where: { id, profileId },
		});
		if (!source) {
			throw new NotFoundException("Income source not found");
		}
		return source;
	}

	async create(profileId: string, dto: CreateIncomeSourceDto): Promise<IncomeSource> {
		const paydayErrors = this.validatePaydays(dto.frequency, dto.paydays);
		if (paydayErrors.length > 0) {
			throw new BadRequestException(paydayErrors);
		}

		await this.validateDestinationAccount(dto.destinationAccountId, profileId);

		return this.prisma.incomeSource.create({
			data: {
				profileId,
				name: dto.name,
				amount: dto.amount,
				frequency: dto.frequency,
				paydays: dto.paydays,
				destinationAccountId: dto.destinationAccountId,
			},
		});
	}

	async update(id: string, profileId: string, dto: UpdateIncomeSourceDto): Promise<IncomeSource> {
		const existing = await this.findOne(id, profileId);

		const frequency = dto.frequency ?? existing.frequency;
		const paydays = dto.paydays ?? existing.paydays;

		const paydayErrors = this.validatePaydays(frequency, paydays);
		if (paydayErrors.length > 0) {
			throw new BadRequestException(paydayErrors);
		}

		if (dto.destinationAccountId) {
			await this.validateDestinationAccount(dto.destinationAccountId, profileId);
		}

		return this.prisma.incomeSource.update({
			where: { id },
			data: dto,
		});
	}

	/** Permanently deletes the income source. Use `deactivate` for a reversible state change. */
	async remove(id: string, profileId: string): Promise<void> {
		await this.findOne(id, profileId);
		await this.prisma.incomeSource.delete({ where: { id } });
	}

	async deactivate(id: string, profileId: string): Promise<IncomeSource> {
		return this.setActive(id, profileId, false);
	}

	async activate(id: string, profileId: string): Promise<IncomeSource> {
		return this.setActive(id, profileId, true);
	}

	async bulkCreate(
		profileId: string,
		sources: Record<string, unknown>[],
	): Promise<BulkCreateResult> {
		const successful: IncomeSource[] = [];
		const failed: FailedIncomeSourceDto[] = [];

		for (const raw of sources) {
			const instance = plainToInstance(CreateIncomeSourceDto, raw);
			const decoratorErrors = await validate(instance, {
				whitelist: true,
				forbidNonWhitelisted: true,
			});

			const decoratorMessages = decoratorErrors.flatMap((e) => Object.values(e.constraints ?? {}));

			const paydayErrors =
				instance.frequency && instance.paydays
					? this.validatePaydays(instance.frequency, instance.paydays)
					: [];

			const allErrors = [...decoratorMessages, ...paydayErrors];

			if (allErrors.length > 0) {
				failed.push({
					input: raw,
					errors: allErrors,
				});
				continue;
			}

			try {
				const destinationErrors = await this.collectDestinationErrors(
					instance.destinationAccountId,
					profileId,
				);
				if (destinationErrors.length > 0) {
					failed.push({
						input: raw,
						errors: destinationErrors,
					});
					continue;
				}

				const created = await this.prisma.incomeSource.create({
					data: {
						profileId,
						name: instance.name,
						amount: instance.amount,
						frequency: instance.frequency,
						paydays: instance.paydays,
						destinationAccountId: instance.destinationAccountId,
					},
				});
				successful.push(created);
			} catch (error) {
				failed.push({
					input: raw,
					errors: [(error as Error).message],
				});
			}
		}

		const total = sources.length;
		const creationState: BulkCreateResult["creationState"] =
			successful.length === total ? "success" : successful.length === 0 ? "failed" : "partial";

		return { creationState, total, successful, failed };
	}

	private async setActive(id: string, profileId: string, isActive: boolean): Promise<IncomeSource> {
		await this.findOne(id, profileId);
		return this.prisma.incomeSource.update({
			where: { id },
			data: { isActive },
		});
	}

	private validatePaydays(frequency: IncomeFrequency, paydays: number[]): string[] {
		const errors: string[] = [];
		const rule = PAYDAY_RULES[frequency];

		if (paydays.length !== rule.count) {
			errors.push(
				`paydays must contain exactly ${rule.count} value(s) for ${frequency} frequency, got ${paydays.length}`,
			);
		}

		for (const d of paydays) {
			if (d < 1 || d > rule.max) {
				errors.push(`payday ${d} is out of range (1-${rule.max}) for ${frequency} frequency`);
			}
		}

		return errors;
	}

	/** For single create/update: throws on invalid. */
	private async validateDestinationAccount(accountId: string, profileId: string): Promise<void> {
		const errors = await this.collectDestinationErrors(accountId, profileId);
		if (errors.length > 0) {
			throw new BadRequestException(errors);
		}
	}

	/** For bulk: returns errors instead of throwing. */
	private async collectDestinationErrors(accountId: string, profileId: string): Promise<string[]> {
		const account = await this.prisma.account.findFirst({
			where: { id: accountId, profileId },
			select: { id: true, type: true },
		});
		if (!account) {
			return ["Destination account not found or does not belong to the user"];
		}
		if (!VALID_DESTINATION_TYPES.includes(account.type)) {
			return [`Destination account must be DEBIT or CASH, got ${account.type}`];
		}
		return [];
	}
}
