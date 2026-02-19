-- =============================================================================
-- Restore Full-Text Search Indexes for Contributions
--
-- Migration 20260213140345 dropped both GIN indexes and relaxed the NOT NULL
-- constraint on search_vector. This migration restores everything.
--
-- All statements are idempotent (DROP IF EXISTS / CREATE OR REPLACE / IF NOT EXISTS)
-- so this migration is safe to apply on any instance regardless of current state.
--
-- Indexes are PARTIAL (WHERE status = 'APPROVED') so they:
--   - Only index the rows that are actually searched
--   - Stay small (draft/rejected contributions are excluded)
--   - Require the query to filter status = 'APPROVED' to use the index
-- =============================================================================

-- 1. Ensure pg_trgm extension exists
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Ensure strip_html helper function exists
--    CREATE OR REPLACE is idempotent — safe even if already present.
CREATE OR REPLACE FUNCTION strip_html(input TEXT) RETURNS TEXT AS $$
BEGIN
  RETURN regexp_replace(
    regexp_replace(input, '<[^>]*>', ' ', 'g'),
    '&[a-zA-Z]+;', ' ', 'g'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

-- 3. Ensure trigger function exists
CREATE OR REPLACE FUNCTION contributions_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.problem, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW."toolsAndTechnologies", ' '), '')), 'A') ||
    setweight(to_tsvector('english', strip_html(COALESCE(NEW.solution, ''))), 'B') ||
    setweight(to_tsvector('english', strip_html(COALESCE(NEW.outcome, ''))), 'B') ||
    setweight(to_tsvector('english', strip_html(COALESCE(NEW.learnings, ''))), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Ensure trigger exists (drop + recreate is idempotent)
DROP TRIGGER IF EXISTS trg_contributions_search_vector ON "contributions";
CREATE TRIGGER trg_contributions_search_vector
  BEFORE INSERT OR UPDATE OF problem, solution, outcome, learnings, "toolsAndTechnologies"
  ON "contributions"
  FOR EACH ROW
  EXECUTE FUNCTION contributions_search_vector_update();

-- 5. Backfill search_vector for any rows where it is NULL
--    Touching `problem` fires the trigger which rebuilds the full tsvector.
UPDATE "contributions" SET problem = problem WHERE search_vector IS NULL;

-- 6. Restore NOT NULL constraint on search_vector
--    No-op if the constraint already exists; backfill above ensures no NULLs remain.
ALTER TABLE "contributions" ALTER COLUMN "search_vector" SET NOT NULL;

-- 7. Drop any existing GIN indexes (full or partial) so we can recreate as partial.
--    Dropping first guarantees fresh instances and already-indexed instances
--    both end up with the correct partial index definition.
DROP INDEX IF EXISTS "idx_contributions_search_vector";
DROP INDEX IF EXISTS "idx_contributions_problem_trgm";

-- 8. Partial GIN index on tsvector — only APPROVED contributions.
--    The query planner uses this index when the WHERE clause includes:
--      c.status = 'APPROVED'::"ContributionStatus"
--    Excluding drafts/submitted/rejected keeps the index small and write-fast.
CREATE INDEX "idx_contributions_search_vector"
  ON "contributions" USING GIN ("search_vector")
  WHERE status = 'APPROVED';

-- 9. Partial trigram GIN index on problem field — only APPROVED contributions.
--    Used by the trigram fallback search when FTS returns no results.
--    Only plain-text `problem` is indexed (solution/outcome/learnings contain HTML
--    which requires strip_html(), preventing direct GIN index usage for those fields).
CREATE INDEX "idx_contributions_problem_trgm"
  ON "contributions" USING GIN ("problem" gin_trgm_ops)
  WHERE status = 'APPROVED';
