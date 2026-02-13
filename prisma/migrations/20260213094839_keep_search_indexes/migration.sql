-- No-op: Prisma sees drift for the search_vector column and GIN indexes because
-- they use types/operators that cannot be fully represented in the Prisma schema.
--
-- The GIN indexes (idx_contributions_search_vector, idx_contributions_problem_trgm)
-- and the NOT NULL constraint on search_vector are managed by the
-- 20260213080000_add_contribution_fulltext_search migration and MUST be kept.
--
-- This migration resolves Prisma's drift detection without altering the database.
SELECT 1;
