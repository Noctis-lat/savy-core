-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('ANNUAL_FEE', 'LATE_PAYMENT', 'CASH_ADVANCE');

-- CreateEnum
CREATE TYPE "InstallmentPlanType" AS ENUM ('MSI', 'MSCI');

-- CreateEnum
CREATE TYPE "InstallmentPlanStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "card_statements" ADD COLUMN     "is_generated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "payment_due_date" TIMESTAMP(3),
ADD COLUMN     "remaining_balance" DECIMAL(12,2),
ADD COLUMN     "updated_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "credit_cards" ADD COLUMN     "over_limit_tolerance" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "payment_due_days" INTEGER DEFAULT 20,
ALTER COLUMN "payment_day" DROP NOT NULL;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "commission_type" "CommissionType",
ADD COLUMN     "statement_id" TEXT;

-- CreateTable
CREATE TABLE "installment_plans" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "type" "InstallmentPlanType" NOT NULL,
    "total_months" INTEGER NOT NULL,
    "current_month" INTEGER NOT NULL DEFAULT 0,
    "monthly_amount" DECIMAL(12,2) NOT NULL,
    "interest_rate" DECIMAL(5,4),
    "status" "InstallmentPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "installment_plans_transaction_id_key" ON "installment_plans"("transaction_id");

-- CreateIndex
CREATE INDEX "installment_plans_transaction_id_idx" ON "installment_plans"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "card_statements_credit_card_id_period_start_key" ON "card_statements"("credit_card_id", "period_start");

-- CreateIndex
CREATE INDEX "transactions_statement_id_idx" ON "transactions"("statement_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "card_statements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: set default payment_due_days for existing credit cards
UPDATE "credit_cards" SET "payment_due_days" = 20 WHERE "payment_due_days" IS NULL;