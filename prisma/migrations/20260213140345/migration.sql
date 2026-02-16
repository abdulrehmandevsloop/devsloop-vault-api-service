-- DropIndex
DROP INDEX "idx_contributions_problem_trgm";

-- DropIndex
DROP INDEX "idx_contributions_search_vector";

-- AlterTable
ALTER TABLE "contributions" ALTER COLUMN "search_vector" DROP NOT NULL;
