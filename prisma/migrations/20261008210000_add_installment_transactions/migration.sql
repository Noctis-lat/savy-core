-- AlterEnum
ALTER TYPE "InstallmentPlanStatus" ADD VALUE 'PAID_OFF';

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'INSTALLMENT';

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "installment_number" INTEGER,
ADD COLUMN     "installment_plan_id" TEXT;

-- CreateIndex
CREATE INDEX "transactions_installment_plan_id_idx" ON "transactions"("installment_plan_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_installment_plan_id_fkey" FOREIGN KEY ("installment_plan_id") REFERENCES "installment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

