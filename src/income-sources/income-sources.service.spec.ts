import { NotFoundException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { QueryIncomeSourcesDto } from "./dto/income-source.dto";
import { IncomeSourcesService } from "./income-sources.service";

describe("IncomeSourcesService (findAll filters)", () => {
	let service: IncomeSourcesService;
	let prisma: { incomeSource: { findMany: jest.Mock } };

	beforeEach(async () => {
		prisma = { incomeSource: { findMany: jest.fn().mockResolvedValue([]) } };
		const module: TestingModule = await Test.createTestingModule({
			providers: [IncomeSourcesService, { provide: PrismaService, useValue: prisma }],
		}).compile();
		service = module.get(IncomeSourcesService);
	});

	it("applies sortBy and order to orderBy", async () => {
		await service.findAllByProfile("p1", { sortBy: "amount", order: "asc" });
		const call = prisma.incomeSource.findMany.mock.calls[0][0];
		expect(call.orderBy).toEqual({ amount: "asc" });
	});

	it("defaults to createdAt desc and isActive true", async () => {
		await service.findAllByProfile("p1", {});
		const call = prisma.incomeSource.findMany.mock.calls[0][0];
		expect(call.orderBy).toEqual({ createdAt: "desc" });
		expect(call.where.isActive).toBe(true);
	});
});

describe("IncomeSourcesService (delete / activate / deactivate)", () => {
	let service: IncomeSourcesService;
	let prisma: {
		incomeSource: { findFirst: jest.Mock; update: jest.Mock; delete: jest.Mock };
	};
	const existing = { id: "s1", profileId: "p1", isActive: true };

	beforeEach(async () => {
		prisma = {
			incomeSource: {
				findFirst: jest.fn().mockResolvedValue(existing),
				update: jest
					.fn()
					.mockImplementation(({ data }: { data: { isActive: boolean } }) =>
						Promise.resolve({ ...existing, ...data }),
					),
				delete: jest.fn().mockResolvedValue(existing),
			},
		};
		const module: TestingModule = await Test.createTestingModule({
			providers: [IncomeSourcesService, { provide: PrismaService, useValue: prisma }],
		}).compile();
		service = module.get(IncomeSourcesService);
	});

	it("remove() hard-deletes the owned income source", async () => {
		await service.remove("s1", "p1");
		expect(prisma.incomeSource.findFirst).toHaveBeenCalledWith({
			where: { id: "s1", profileId: "p1" },
		});
		expect(prisma.incomeSource.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
		expect(prisma.incomeSource.update).not.toHaveBeenCalled();
	});

	it("remove() throws NotFoundException when not owned", async () => {
		prisma.incomeSource.findFirst.mockResolvedValue(null);
		await expect(service.remove("s1", "other")).rejects.toBeInstanceOf(NotFoundException);
		expect(prisma.incomeSource.delete).not.toHaveBeenCalled();
	});

	it("deactivate() sets isActive to false", async () => {
		const result = await service.deactivate("s1", "p1");
		expect(prisma.incomeSource.update).toHaveBeenCalledWith({
			where: { id: "s1" },
			data: { isActive: false },
		});
		expect(result.isActive).toBe(false);
	});

	it("activate() sets isActive to true", async () => {
		prisma.incomeSource.findFirst.mockResolvedValue({ ...existing, isActive: false });
		const result = await service.activate("s1", "p1");
		expect(prisma.incomeSource.update).toHaveBeenCalledWith({
			where: { id: "s1" },
			data: { isActive: true },
		});
		expect(result.isActive).toBe(true);
	});

	it("deactivate() throws NotFoundException when not found", async () => {
		prisma.incomeSource.findFirst.mockResolvedValue(null);
		await expect(service.deactivate("missing", "p1")).rejects.toBeInstanceOf(NotFoundException);
		expect(prisma.incomeSource.update).not.toHaveBeenCalled();
	});

	it("activate() throws NotFoundException when not found", async () => {
		prisma.incomeSource.findFirst.mockResolvedValue(null);
		await expect(service.activate("missing", "p1")).rejects.toBeInstanceOf(NotFoundException);
		expect(prisma.incomeSource.update).not.toHaveBeenCalled();
	});
});

describe("QueryIncomeSourcesDto validation", () => {
	it("rejects an invalid sortBy value", async () => {
		const instance = plainToInstance(QueryIncomeSourcesDto, { sortBy: "bogus" });
		const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
		expect(errors.some((e) => e.property === "sortBy")).toBe(true);
	});
});
