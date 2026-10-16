-- IncomeSource: add categoryId and lastGeneratedAt
ALTER TABLE "income_sources" ADD COLUMN "category_id" TEXT;
ALTER TABLE "income_sources" ADD COLUMN "last_generated_at" TIMESTAMP(3);

-- Transaction: add incomeSourceId
ALTER TABLE "transactions" ADD COLUMN "income_source_id" TEXT;

-- Create BudgetKind enum
CREATE TYPE "BudgetKind" AS ENUM ('RECURRING', 'ONE_TIME');

-- Budget: add new columns (name nullable for now, kind with default, period nullable)
ALTER TABLE "budgets" ADD COLUMN "name" TEXT;
ALTER TABLE "budgets" ADD COLUMN "kind" "BudgetKind" NOT NULL DEFAULT 'RECURRING';
ALTER TABLE "budgets" ALTER COLUMN "period" DROP NOT NULL;
ALTER TABLE "budgets" ALTER COLUMN "period" DROP DEFAULT;

-- Create budget_items table
CREATE TABLE "budget_items" (
    "id" TEXT NOT NULL,
    "budget_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_items_pkey" PRIMARY KEY ("id")
);

-- Create budget_period_snapshots table
CREATE TABLE "budget_period_snapshots" (
    "id" TEXT NOT NULL,
    "budget_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "total_planned" DECIMAL(12,2) NOT NULL,
    "total_spent" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_period_snapshots_pkey" PRIMARY KEY ("id")
);

-- Create budget_item_snapshots table
CREATE TABLE "budget_item_snapshots" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "budget_item_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "planned_amount" DECIMAL(12,2) NOT NULL,
    "spent_amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "budget_item_snapshots_pkey" PRIMARY KEY ("id")
);

-- Data migration: for each existing budget, create a BudgetItem and set name
INSERT INTO "budget_items" ("id", "budget_id", "category_id", "amount", "created_at", "updated_at")
SELECT
    gen_random_uuid(),
    b."id",
    b."category_id",
    b."amount",
    NOW(),
    NOW()
FROM "budgets" b;

-- Set budget name from the linked category name (or 'Budget' as fallback)
UPDATE "budgets" b
SET "name" = COALESCE(c."name", 'Budget')
FROM "categories" c
WHERE b."category_id" = c."id";

-- For any budgets without a matching category, set a default name
UPDATE "budgets" SET "name" = 'Budget' WHERE "name" IS NULL;

-- Now safe to drop old columns from budgets
ALTER TABLE "budgets" DROP COLUMN "category_id";
ALTER TABLE "budgets" DROP COLUMN "amount";

-- Make name NOT NULL now that all rows have a value
ALTER TABLE "budgets" ALTER COLUMN "name" SET NOT NULL;

-- Add foreign keys for budget_items
ALTER TABLE "budget_items"
    ADD CONSTRAINT "budget_items_budget_id_fkey"
    FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE;
ALTER TABLE "budget_items"
    ADD CONSTRAINT "budget_items_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE;

-- Add foreign keys for budget_period_snapshots
ALTER TABLE "budget_period_snapshots"
    ADD CONSTRAINT "budget_period_snapshots_budget_id_fkey"
    FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE;

-- Add foreign keys for budget_item_snapshots
ALTER TABLE "budget_item_snapshots"
    ADD CONSTRAINT "budget_item_snapshots_snapshot_id_fkey"
    FOREIGN KEY ("snapshot_id") REFERENCES "budget_period_snapshots"("id") ON DELETE CASCADE;

-- Add foreign key for income_sources.category_id
ALTER TABLE "income_sources"
    ADD CONSTRAINT "income_sources_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL;

-- Add foreign key for transactions.income_source_id
ALTER TABLE "transactions"
    ADD CONSTRAINT "transactions_income_source_id_fkey"
    FOREIGN KEY ("income_source_id") REFERENCES "income_sources"("id") ON DELETE SET NULL;

-- Add unique constraints
CREATE UNIQUE INDEX "budget_items_budget_id_category_id_key" ON "budget_items"("budget_id", "category_id");
CREATE UNIQUE INDEX "budget_period_snapshots_budget_id_period_start_key" ON "budget_period_snapshots"("budget_id", "period_start");

-- Add indexes
CREATE INDEX "budgets_profile_id_idx" ON "budgets"("profile_id");
CREATE INDEX "budget_items_budget_id_idx" ON "budget_items"("budget_id");
CREATE INDEX "budget_items_category_id_idx" ON "budget_items"("category_id");
CREATE INDEX "budget_period_snapshots_budget_id_idx" ON "budget_period_snapshots"("budget_id");
CREATE INDEX "budget_item_snapshots_snapshot_id_idx" ON "budget_item_snapshots"("snapshot_id");
CREATE INDEX "transactions_income_source_id_idx" ON "transactions"("income_source_id");