import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator";
import {
	ApiArraySuccessResponse,
	ApiErrorResponse,
	ApiMessageResponse,
	ApiSuccessResponse,
} from "../common/decorators/api-response.decorator";
import type { Profile } from "../generated/prisma/client";
import { CardStatementsService } from "./card-statements.service";
import {
	CardStatementResponseDto,
	CreateCardStatementDto,
	QueryCardStatementsDto,
	StatementTransactionResponseDto,
	UpdateCardStatementDto,
} from "./dto/card-statement.dto";
import { StatementGenerationService } from "./statement-generation.service";

@ApiTags("card-statements")
@ApiBearerAuth()
@Controller("card-statements")
export class CardStatementsController {
	constructor(
		private readonly cardStatementsService: CardStatementsService,
		private readonly statementGenerationService: StatementGenerationService,
	) {}

	@Get()
	@ApiOperation({ summary: "List all card statements for the current user with optional filters" })
	@ApiArraySuccessResponse(200, CardStatementResponseDto, "Returns array of card statements")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(500, "Internal server error")
	async findAll(@CurrentUser() profile: Profile, @Query() query: QueryCardStatementsDto) {
		// Lazy statement generation: generate any pending statements before reading
		await this.statementGenerationService.generatePending(profile.id);
		return this.cardStatementsService.findAllByProfile(profile.id, {
			creditCardId: query.creditCardId,
			isPaid: query.isPaid === undefined ? undefined : query.isPaid === "true",
			sortBy: query.sortBy,
			order: query.order,
		});
	}

	@Get(":id")
	@ApiOperation({ summary: "Get a single card statement by ID" })
	@ApiSuccessResponse(200, CardStatementResponseDto, "Returns the card statement")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Card statement not found")
	@ApiErrorResponse(500, "Internal server error")
	async findOne(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.cardStatementsService.findOne(id, profile.id);
	}

	@Get(":id/transactions")
	@ApiOperation({
		summary:
			"List the transactions of a card statement: installments first (with plan summary), then purchases, payments, commissions and interest",
	})
	@ApiArraySuccessResponse(
		200,
		StatementTransactionResponseDto,
		"Returns the statement transactions",
	)
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Card statement not found")
	@ApiErrorResponse(500, "Internal server error")
	async findTransactions(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.cardStatementsService.findTransactions(id, profile.id);
	}

	@Post()
	@ApiOperation({ summary: "Create a new card statement" })
	@ApiSuccessResponse(201, CardStatementResponseDto, "Returns the created card statement")
	@ApiErrorResponse(400, "Validation error or invalid request data")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Credit card not found")
	@ApiErrorResponse(500, "Internal server error")
	async create(@CurrentUser() profile: Profile, @Body() dto: CreateCardStatementDto) {
		return this.cardStatementsService.create(profile.id, dto);
	}

	@Patch(":id")
	@ApiOperation({ summary: "Update a card statement (mark as paid, adjust amounts)" })
	@ApiSuccessResponse(200, CardStatementResponseDto, "Returns the updated card statement")
	@ApiErrorResponse(400, "Validation error or invalid request data")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Card statement not found")
	@ApiErrorResponse(500, "Internal server error")
	async update(
		@Param("id") id: string,
		@CurrentUser() profile: Profile,
		@Body() dto: UpdateCardStatementDto,
	) {
		return this.cardStatementsService.update(id, profile.id, dto);
	}

	@Delete(":id")
	@ApiOperation({ summary: "Delete a card statement" })
	@ApiMessageResponse(200, "Card statement deleted")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Card statement not found")
	@ApiErrorResponse(500, "Internal server error")
	async remove(@Param("id") id: string, @CurrentUser() profile: Profile) {
		await this.cardStatementsService.remove(id, profile.id);
		return { message: "Card statement deleted" };
	}
}
