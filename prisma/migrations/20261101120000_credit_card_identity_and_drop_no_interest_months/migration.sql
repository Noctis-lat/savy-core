-- Entity-superior pattern: credit cards own name/color/icon; accounts are logical resources.

-- AlterTable: add identity columns (name nullable until backfilled)
ALTER TABLE "credit_cards" ADD COLUMN "name" TEXT,
ADD COLUMN "color" TEXT,
ADD COLUMN "icon" TEXT;

-- Backfill credit card identity from the linked account
UPDATE "credit_cards" cc
SET "name" = a."name", "color" = a."color", "icon" = a."icon"
FROM "accounts" a
WHERE a."id" = cc."account_id";

-- Enforce NOT NULL on name after backfill
ALTER TABLE "credit_cards" ALTER COLUMN "name" SET NOT NULL;

-- Drop unused column
ALTER TABLE "credit_cards" DROP COLUMN "no_interest_months";

-- Re-sync accounts from savings goals (the goal is the source of truth)
UPDATE "accounts" a
SET "name" = sg."name", "color" = sg."color", "icon" = sg."icon"
FROM "savings_goals" sg
WHERE sg."account_id" = a."id";
