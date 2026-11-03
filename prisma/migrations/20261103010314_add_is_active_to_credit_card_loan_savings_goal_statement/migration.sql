-- AlterTable
ALTER TABLE "card_statements" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "credit_cards" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "savings_goals" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;
