-- =============================================================================
-- Full-Text Search for Contributions
-- PostgreSQL tsvector + GIN index + pg_trgm for typo tolerance
-- =============================================================================

-- 1. Enable pg_trgm extension (typo-tolerant fallback search)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Helper function: strip HTML tags and entities from rich-text content
--    Input is sanitized HTML from the Quill editor (guaranteed well-formed).
CREATE OR REPLACE FUNCTION strip_html(input TEXT) RETURNS TEXT AS $$
BEGIN
  RETURN regexp_replace(
    regexp_replace(input, '<[^>]*>', ' ', 'g'),   -- Strip HTML tags
    '&[a-zA-Z]+;', ' ', 'g'                        -- Strip HTML entities
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

-- 3. Add search_vector column to contributions
ALTER TABLE "contributions" ADD COLUMN "search_vector" tsvector;

-- 4. Trigger function: builds a weighted tsvector from all searchable fields
--    Weights: A (highest) = problem + tools, B = solution + outcome, C = learnings
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

-- 5. Trigger: fires on INSERT or UPDATE of searchable fields
CREATE TRIGGER trg_contributions_search_vector
  BEFORE INSERT OR UPDATE OF problem, solution, outcome, learnings, "toolsAndTechnologies"
  ON "contributions"
  FOR EACH ROW
  EXECUTE FUNCTION contributions_search_vector_update();

-- 6. Backfill existing rows (trigger fires on each UPDATE)
UPDATE "contributions" SET problem = problem WHERE search_vector IS NULL;

-- 7. Make column NOT NULL after backfill
ALTER TABLE "contributions" ALTER COLUMN "search_vector" SET NOT NULL;

-- 8. GIN index on tsvector column (primary full-text search index)
CREATE INDEX "idx_contributions_search_vector"
  ON "contributions" USING GIN ("search_vector");

-- 9. Trigram GIN index on problem field (typo-tolerant fallback)
CREATE INDEX "idx_contributions_problem_trgm"
  ON "contributions" USING GIN ("problem" gin_trgm_ops);
