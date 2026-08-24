import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class BankCreditCardResponseDto {
	@ApiProperty({ example: "card-uuid", description: "Credit card ID" })
	id!: string;

	@ApiProperty({ example: "acc-uuid", description: "Associated account ID" })
	accountId!: string;

	@ApiProperty({ example: "BBVA Platinum", description: "Account display name" })
	accountName!: string;

	@ApiProperty({ example: "5000000", description: "Current account balance (Decimal)" })
	balance!: unknown;

	@ApiProperty({ example: "5000000", description: "Credit limit (Decimal)" })
	creditLimit!: unknown;

	@ApiProperty({ example: 15, description: "Statement cut day (1-31)" })
	cutDay!: number;

	@ApiProperty({ example: 25, description: "Payment due day (1-31)" })
	paymentDay!: number;

	@ApiProperty({ example: "0.3600", description: "Annual interest rate (Decimal)" })
	interestRate!: unknown;

	@ApiProperty({ example: 0, description: "Months at no interest" })
	noInterestMonths!: number;

	@ApiProperty({ example: "2026-01-01T00:00:00.000Z", description: "Creation date" })
	createdAt!: Date;

	@ApiProperty({ example: "2026-07-01T00:00:00.000Z", description: "Last update date" })
	updatedAt!: Date;
}

export class BankLoanResponseDto {
	@ApiProperty({ example: "loan-uuid", description: "Loan ID" })
	id!: string;

	@ApiProperty({ example: "acc-uuid", description: "Associated account ID" })
	accountId!: string;

	@ApiProperty({ example: "Loan BBVA", description: "Account display name" })
	accountName!: string;

	@ApiProperty({ example: 20000000, description: "Loan principal in integer cents" })
	principal!: number;

	@ApiProperty({
		example: 0.165,
		description: "Annual interest rate as decimal (0.165 = 16.5%)",
	})
	interestRate!: number;

	@ApiProperty({ example: 36, description: "Loan term in months" })
	termMonths!: number;

	@ApiProperty({ example: "2024-01-15T00:00:00.000Z", description: "Loan start date (ISO)" })
	startDate!: string;

	@ApiProperty({ example: 680000, description: "Monthly payment in integer cents" })
	monthlyPayment!: number;

	@ApiProperty({ example: 15000000, description: "Remaining balance in integer cents" })
	remaining!: number;

	@ApiProperty({ example: 25, description: "Progress percentage paid (0-100)" })
	progress!: number;

	@ApiProperty({ example: "2024-01-15T00:00:00.000Z", description: "Creation date (ISO)" })
	createdAt!: string;

	@ApiProperty({ example: "2026-07-01T00:00:00.000Z", description: "Last update date (ISO)" })
	updatedAt!: string;
}
