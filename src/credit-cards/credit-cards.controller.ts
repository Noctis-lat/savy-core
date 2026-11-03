import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator";
import {
	ApiErrorResponse,
	ApiMessageResponse,
	ApiSuccessResponse,
} from "../common/decorators/api-response.decorator";
import type { Profile } from "../generated/prisma/client";
import { CreditCardsService } from "./credit-cards.service";
import {
	CreateCreditCardDto,
	CreditCardListResponseDto,
	CreditCardResponseDto,
	QueryCreditCardsDto,
	UpdateCreditCardDto,
} from "./dto/credit-card.dto";

@ApiTags("credit-cards")
@ApiBearerAuth()
@Controller("credit-cards")
export class CreditCardsController {
	constructor(private readonly creditCardsService: CreditCardsService) {}

	@Get()
	@ApiOperation({
		summary: "List all credit cards for the current user with pagination and aggregated info",
	})
	@ApiSuccessResponse(200, CreditCardListResponseDto, "Returns paginated credit cards with totals")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(500, "Internal server error")
	async findAll(@CurrentUser() profile: Profile, @Query() query: QueryCreditCardsDto) {
		return this.creditCardsService.findAllByProfile(profile.id, {
			sortBy: query.sortBy,
			order: query.order,
			page: query.page,
			perPage: query.perPage,
			search: query.search,
			isActive: query.isActive === undefined ? undefined : query.isActive === "true",
			bankId: query.bankId,
			hasUnpaidStatement:
				query.hasUnpaidStatement === undefined ? undefined : query.hasUnpaidStatement === "true",
		});
	}

	@Get(":id")
	@ApiOperation({ summary: "Get a single credit card by ID" })
	@ApiSuccessResponse(200, CreditCardResponseDto, "Returns the credit card")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Credit card not found")
	@ApiErrorResponse(500, "Internal server error")
	async findOne(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.creditCardsService.findOne(id, profile.id);
	}

	@Get("account/:accountId")
	@ApiOperation({ summary: "Get the credit card linked to a given account ID" })
	@ApiSuccessResponse(
		200,
		CreditCardResponseDto,
		"Returns the credit card linked to the account, with computed fields",
	)
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Credit card not found for this account")
	@ApiErrorResponse(500, "Internal server error")
	async findByAccount(@Param("accountId") accountId: string, @CurrentUser() profile: Profile) {
		return this.creditCardsService.findByAccount(accountId, profile.id);
	}

	@Post()
	@ApiOperation({ summary: "Create credit card details for a CREDIT account" })
	@ApiSuccessResponse(201, CreditCardResponseDto, "Returns the created credit card")
	@ApiErrorResponse(400, "Validation error or account must be CREDIT type or already has a card")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Account not found")
	@ApiErrorResponse(500, "Internal server error")
	async create(@CurrentUser() profile: Profile, @Body() dto: CreateCreditCardDto) {
		return this.creditCardsService.create(profile.id, dto);
	}

	@Patch(":id")
	@ApiOperation({ summary: "Update a credit card by ID" })
	@ApiSuccessResponse(200, CreditCardResponseDto, "Returns the updated credit card")
	@ApiErrorResponse(400, "Validation error or invalid request data")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Credit card not found")
	@ApiErrorResponse(500, "Internal server error")
	async update(
		@Param("id") id: string,
		@CurrentUser() profile: Profile,
		@Body() dto: UpdateCreditCardDto,
	) {
		return this.creditCardsService.update(id, profile.id, dto);
	}

	@Delete(":id")
	@ApiOperation({
		summary:
			"Deactivate a credit card (soft delete — keeps history, hides the card and its account)",
	})
	@ApiMessageResponse(200, "Credit card deactivated")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Credit card not found")
	@ApiErrorResponse(500, "Internal server error")
	async remove(@Param("id") id: string, @CurrentUser() profile: Profile) {
		await this.creditCardsService.remove(id, profile.id);
		return { message: "Credit card deactivated" };
	}

	@Patch(":id/activate")
	@ApiOperation({
		summary: "Reactivate a previously deactivated credit card and its linked account",
	})
	@ApiSuccessResponse(200, CreditCardResponseDto, "Returns the reactivated credit card")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Credit card not found")
	@ApiErrorResponse(500, "Internal server error")
	async activate(@Param("id") id: string, @CurrentUser() profile: Profile) {
		return this.creditCardsService.activate(id, profile.id);
	}

	@Delete(":id/permanent")
	@ApiOperation({
		summary:
			"Permanently delete a credit card and its account (hard delete — cascade removes statements and transactions)",
	})
	@ApiMessageResponse(200, "Credit card and its account permanently deleted")
	@ApiErrorResponse(401, "Unauthorized")
	@ApiErrorResponse(404, "Credit card not found")
	@ApiErrorResponse(500, "Internal server error")
	async removePermanent(@Param("id") id: string, @CurrentUser() profile: Profile) {
		await this.creditCardsService.removePermanent(id, profile.id);
		return { message: "Credit card and its account permanently deleted" };
	}
}
