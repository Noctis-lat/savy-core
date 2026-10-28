-- AlterTable
ALTER TABLE "recurring_expenses" ADD COLUMN     "last_generated_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "recurring_expense_id" TEXT;

-- CreateIndex
CREATE INDEX "transactions_recurring_expense_id_idx" ON "transactions"("recurring_expense_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_expense_id_fkey" FOREIGN KEY ("recurring_expense_id") REFERENCES "recurring_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
