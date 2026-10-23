-- DropForeignKey
ALTER TABLE "budget_item_snapshots" DROP CONSTRAINT "budget_item_snapshots_snapshot_id_fkey";

-- DropForeignKey
ALTER TABLE "budget_items" DROP CONSTRAINT "budget_items_budget_id_fkey";

-- DropForeignKey
ALTER TABLE "budget_items" DROP CONSTRAINT "budget_items_category_id_fkey";

-- DropForeignKey
ALTER TABLE "budget_period_snapshots" DROP CONSTRAINT "budget_period_snapshots_budget_id_fkey";

-- DropForeignKey
ALTER TABLE "income_sources" DROP CONSTRAINT "income_sources_category_id_fkey";

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_income_source_id_fkey";

-- AlterTable
ALTER TABLE "savings_goals" ADD COLUMN     "icon" TEXT;

-- AddForeignKey
ALTER TABLE "income_sources" ADD CONSTRAINT "income_sources_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_income_source_id_fkey" FOREIGN KEY ("income_source_id") REFERENCES "income_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_period_snapshots" ADD CONSTRAINT "budget_period_snapshots_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_item_snapshots" ADD CONSTRAINT "budget_item_snapshots_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "budget_period_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
