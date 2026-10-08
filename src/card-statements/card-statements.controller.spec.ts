import { Test, type TestingModule } from "@nestjs/testing";
import type { Profile } from "../generated/prisma/client";
import { CardStatementsController } from "./card-statements.controller";
import { CardStatementsService } from "./card-statements.service";
import { StatementGenerationService } from "./statement-generation.service";

describe("CardStatementsController", () => {
	let controller: CardStatementsController;
	let cardStatementsService: { findAllByProfile: jest.Mock };
	let statementGenerationService: { generatePending: jest.Mock };

	beforeEach(async () => {
		cardStatementsService = {
			findAllByProfile: jest.fn().mockResolvedValue([]),
		};
		statementGenerationService = {
			generatePending: jest.fn().mockResolvedValue(undefined),
		};

		const module: TestingModule = await Test.createTestingModule({
			controllers: [CardStatementsController],
			providers: [
				{ provide: CardStatementsService, useValue: cardStatementsService },
				{ provide: StatementGenerationService, useValue: statementGenerationService },
			],
		}).compile();
		controller = module.get(CardStatementsController);
	});

	describe("findAll", () => {
		it("calls statementGenerationService.generatePending before delegating to findAllByProfile", async () => {
			const profile = { id: "profile-1" } as Profile;

			await controller.findAll(profile, {});

			expect(statementGenerationService.generatePending).toHaveBeenCalledWith("profile-1");
			expect(cardStatementsService.findAllByProfile).toHaveBeenCalledWith(
				"profile-1",
				expect.anything(),
			);
		});

		it("calls generatePending BEFORE findAllByProfile (order matters for lazy generation)", async () => {
			const profile = { id: "profile-1" } as Profile;
			const callOrder: string[] = [];

			statementGenerationService.generatePending.mockImplementation(async () => {
				callOrder.push("generatePending");
			});
			cardStatementsService.findAllByProfile.mockImplementation(async () => {
				callOrder.push("findAllByProfile");
				return [];
			});

			await controller.findAll(profile, {});

			expect(callOrder).toEqual(["generatePending", "findAllByProfile"]);
		});
	});
});
