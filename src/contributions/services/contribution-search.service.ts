import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma';
import { ContentProcessingService } from './content-processing.service';
import {
  SearchContributionsQueryDto,
  SearchContributionsResponseDto,
  SearchContributionItemDto,
  ContributionResponseDto,
} from '../dto';
import { CONTRIBUTION_SELECT_FIELDS } from '../interfaces';

/** Headline options shared by all ts_headline calls. */
const HEADLINE_OPTIONS = 'StartSel=<mark>, StopSel=</mark>';

/** Raw row from the full-text search query. */
interface SearchResultRow {
  id: string;
  rank: number;
  problem_highlight: string | null;
  solution_highlight: string | null;
  outcome_highlight: string | null;
  learnings_highlight: string | null;
}

/** Raw row from the trigram fallback query. */
interface TrigramResultRow {
  id: string;
  rank: number;
  problem_highlight: string | null;
  solution_highlight: string | null;
  outcome_highlight: string | null;
  learnings_highlight: string | null;
}

@Injectable()
export class ContributionSearchService {
  private readonly logger = new Logger(ContributionSearchService.name);

  /** Only approved contributions are searchable — enforced at the service level. */
  private static readonly SEARCHABLE_STATUS = 'APPROVED';

  constructor(
    private readonly prisma: PrismaService,
    private readonly contentProcessing: ContentProcessingService,
  ) {}

  /**
   * Search approved contributions via full-text search with trigram fallback.
   *
   * Phase 1: Full-text search (websearch_to_tsquery + GIN-indexed tsvector).
   * Phase 2: Trigram similarity fallback on the problem field if Phase 1 yields nothing.
   *
   * All queries use Prisma $queryRaw tagged templates (auto-parameterised).
   */
  async search(
    query: SearchContributionsQueryDto,
    _currentUserId: string,
  ): Promise<SearchContributionsResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;
    const searchQuery = query.q.trim();
    // Normalize: empty array or undefined = no filter
    const projectIds =
      query.projectIds && query.projectIds.length > 0
        ? query.projectIds.filter((id) => id && id.trim().length > 0)
        : null;

    // Phase 1: Full-text search
    const fts = await this.fullTextSearch(searchQuery, projectIds, limit, offset);

    if (fts.total > 0) {
      const items = await this.hydrateResults(fts.rows);
      return this.buildResponse(items, fts.total, page, limit, searchQuery, false);
    }

    // Phase 2: Trigram fallback (typo tolerance)
    const trgm = await this.trigramSearch(searchQuery, projectIds, limit, offset);

    if (trgm.total > 0) {
      // Trigram results now include highlights, so use them directly
      const items = await this.hydrateResults(trgm.rows);
      return this.buildResponse(items, trgm.total, page, limit, searchQuery, true);
    }

    return this.buildResponse([], 0, page, limit, searchQuery, false);
  }

  // ---------------------------------------------------------------------------
  // Full-text search (Phase 1)
  // ---------------------------------------------------------------------------

  private async fullTextSearch(
    searchQuery: string,
    projectIds: string[] | null,
    limit: number,
    offset: number,
  ): Promise<{ rows: SearchResultRow[]; total: number }> {
    const status = ContributionSearchService.SEARCHABLE_STATUS;
    const startTime = Date.now();

    // Transform query to use OR logic: split words and join with |
    // This ensures if ANY word matches, results are returned
    const words = searchQuery.split(/\s+/).filter((w) => w.length > 0);

    // Build OR query: for multiple words, join with | operator
    // Remove special tsquery characters that could break the query
    const cleanWord = (str: string): string => {
      return str.replace(/[():&|!]/g, '');
    };

    const orQuery =
      words.length > 1 ? words.map((w) => cleanWord(w)).join(' | ') : cleanWord(searchQuery);

    // Build project filter condition - use Prisma.sql with array parameter
    const projectFilter =
      projectIds && projectIds.length > 0
        ? Prisma.sql`AND c."projectId" = ANY(${projectIds}::text[])`
        : Prisma.empty;

    // Use to_tsquery with OR operators for multi-word queries
    // This allows ANY word to match (OR logic instead of AND)
    // Escape single quotes for SQL injection safety
    const escapedOrQuery = orQuery.replace(/'/g, "''");
    const [{ count }] = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count
      FROM "contributions" c, to_tsquery('english', ${Prisma.raw(`'${escapedOrQuery}'`)}) query
      WHERE c.search_vector @@ query
        AND c.status::text = ${status}
        ${projectFilter}
    `;
    const total = Number(count);

    if (total === 0) return { rows: [], total: 0 };

    const rows = await this.prisma.$queryRaw<SearchResultRow[]>`
      SELECT
        c.id,
        ts_rank_cd(c.search_vector, query) AS rank,
        ts_headline('english', c.problem, query,
          ${`MaxWords=35, MinWords=15, ${HEADLINE_OPTIONS}`}) AS problem_highlight,
        ts_headline('english', strip_html(COALESCE(c.solution, '')), query,
          ${`MaxWords=50, MinWords=20, ${HEADLINE_OPTIONS}`}) AS solution_highlight,
        ts_headline('english', strip_html(COALESCE(c.outcome, '')), query,
          ${`MaxWords=50, MinWords=20, ${HEADLINE_OPTIONS}`}) AS outcome_highlight,
        ts_headline('english', strip_html(COALESCE(c.learnings, '')), query,
          ${`MaxWords=50, MinWords=20, ${HEADLINE_OPTIONS}`}) AS learnings_highlight
      FROM "contributions" c, to_tsquery('english', ${Prisma.raw(`'${escapedOrQuery}'`)}) query
      WHERE c.search_vector @@ query
        AND c.status::text = ${status}
        ${projectFilter}
      ORDER BY rank DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    this.logSlowQuery('FTS', searchQuery, Date.now() - startTime);
    return { rows, total };
  }

  // ---------------------------------------------------------------------------
  // Trigram fallback (Phase 2)
  // ---------------------------------------------------------------------------

  private async trigramSearch(
    searchQuery: string,
    projectIds: string[] | null,
    limit: number,
    offset: number,
  ): Promise<{ rows: TrigramResultRow[]; total: number }> {
    const status = ContributionSearchService.SEARCHABLE_STATUS;
    const startTime = Date.now();

    // Build project filter condition
    const projectFilter =
      projectIds && projectIds.length > 0
        ? Prisma.sql`AND c."projectId" = ANY(${projectIds}::text[])`
        : Prisma.empty;

    // For prefix matching (short queries), use word_similarity which is better for partial word matches
    // word_similarity compares the query against words in the text, perfect for "mini" -> "minimum"
    // For longer queries, use regular similarity
    const useWordSimilarity = searchQuery.length <= 6;

    // Use lower similarity threshold for short queries (prefix matching)
    // word_similarity works better with lower thresholds for prefixes (0.15 vs 0.3)
    const similarityThreshold = useWordSimilarity ? 0.15 : 0.3;

    // Search across all text fields (problem, solution, outcome, learnings)
    // Use word_similarity for short queries (prefix matching), similarity for longer queries
    // Use GREATEST to get the highest similarity score across all fields
    // Escape searchQuery for SQL injection safety (used in similarity functions)
    const escapedQueryForSimilarity = searchQuery.replace(/'/g, "''");

    // Build similarity expressions - use word_similarity for prefix matching
    const simExpr1 = useWordSimilarity
      ? Prisma.sql`word_similarity(${escapedQueryForSimilarity}, c.problem)`
      : Prisma.sql`similarity(c.problem, ${escapedQueryForSimilarity})`;
    const simExpr2 = useWordSimilarity
      ? Prisma.sql`word_similarity(${escapedQueryForSimilarity}, strip_html(COALESCE(c.solution, '')))`
      : Prisma.sql`similarity(strip_html(COALESCE(c.solution, '')), ${escapedQueryForSimilarity})`;
    const simExpr3 = useWordSimilarity
      ? Prisma.sql`word_similarity(${escapedQueryForSimilarity}, strip_html(COALESCE(c.outcome, '')))`
      : Prisma.sql`similarity(strip_html(COALESCE(c.outcome, '')), ${escapedQueryForSimilarity})`;
    const simExpr4 = useWordSimilarity
      ? Prisma.sql`word_similarity(${escapedQueryForSimilarity}, strip_html(COALESCE(c.learnings, '')))`
      : Prisma.sql`similarity(strip_html(COALESCE(c.learnings, '')), ${escapedQueryForSimilarity})`;

    // For prefix matching (word_similarity), require that the query appears as a prefix or whole word
    // This prevents false matches like "mum" matching "minimum" when "mum" isn't a meaningful match
    // Use word boundary regex: \yquery matches word boundary + query (whole word or prefix)
    // Escape regex special characters in the query
    const regexEscapedForFilter = escapedQueryForSimilarity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefixFilter = useWordSimilarity
      ? Prisma.sql`AND (
          c.problem ~* ${Prisma.raw(`'\\y${regexEscapedForFilter}'`)}
          OR strip_html(COALESCE(c.solution, '')) ~* ${Prisma.raw(`'\\y${regexEscapedForFilter}'`)}
          OR strip_html(COALESCE(c.outcome, '')) ~* ${Prisma.raw(`'\\y${regexEscapedForFilter}'`)}
          OR strip_html(COALESCE(c.learnings, '')) ~* ${Prisma.raw(`'\\y${regexEscapedForFilter}'`)}
        )`
      : Prisma.empty;

    const [{ count }] = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count
      FROM "contributions" c
      WHERE GREATEST(${simExpr1}, ${simExpr2}, ${simExpr3}, ${simExpr4}) > ${similarityThreshold}
        AND c.status::text = ${status}
        ${prefixFilter}
        ${projectFilter}
    `;
    const total = Number(count);

    if (total === 0) return { rows: [], total: 0 };

    // Generate highlights for trigram results using ts_headline
    // For prefix matching (short queries), use to_tsquery with prefix operator (mini:*)
    // This allows highlighting partial words like "mini" in "minimum"
    // For longer queries, use plainto_tsquery for normal word matching
    // Escape the query for SQL injection safety
    const escapedQuery = searchQuery.replace(/'/g, "''").replace(/[():&|!]/g, '');

    // Build the tsquery: prefix matching for short queries, normal for longer
    // For prefix matching, ts_headline highlights entire matched words
    // We need to post-process to highlight only the matching prefix portion
    const tsQueryExpr = useWordSimilarity
      ? Prisma.sql`to_tsquery('english', ${escapedQuery} || ':*')`
      : Prisma.sql`plainto_tsquery('english', ${escapedQuery})`;

    // Escape the query for regex (escape special regex characters)
    const regexEscapedQuery = escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // For prefix matching: get headline, strip existing marks, then highlight only prefix
    // ts_headline wraps entire words in <mark> tags, so we strip them first
    const problemHeadline = Prisma.sql`ts_headline('english', c.problem, ${tsQueryExpr},
      ${`MaxWords=35, MinWords=15, ${HEADLINE_OPTIONS}`})`;
    const solutionHeadline = Prisma.sql`ts_headline('english', strip_html(c.solution), ${tsQueryExpr},
      ${`MaxWords=50, MinWords=20, ${HEADLINE_OPTIONS}`})`;

    // Strip existing mark tags, then highlight only the matching prefix portion
    const problemHighlightExpr = useWordSimilarity
      ? Prisma.sql`regexp_replace(
          regexp_replace(${problemHeadline}, '<mark>|</mark>', '', 'g'),
          ${Prisma.raw(`'\\y(${regexEscapedQuery})(\\w*)'`)}::text,
          ${`'<mark>\\1</mark>\\2'`}::text,
          'gi'
        )`
      : problemHeadline;

    const solutionHighlightExpr = useWordSimilarity
      ? Prisma.sql`regexp_replace(
          regexp_replace(${solutionHeadline}, '<mark>|</mark>', '', 'g'),
          ${Prisma.raw(`'\\y(${regexEscapedQuery})(\\w*)'`)}::text,
          ${`'<mark>\\1</mark>\\2'`}::text,
          'gi'
        )`
      : solutionHeadline;

    const outcomeHeadline = Prisma.sql`ts_headline('english', strip_html(COALESCE(c.outcome, '')), ${tsQueryExpr},
      ${`MaxWords=50, MinWords=20, ${HEADLINE_OPTIONS}`})`;
    const learningsHeadline = Prisma.sql`ts_headline('english', strip_html(COALESCE(c.learnings, '')), ${tsQueryExpr},
      ${`MaxWords=50, MinWords=20, ${HEADLINE_OPTIONS}`})`;
    const outcomeHighlightExpr = useWordSimilarity
      ? Prisma.sql`regexp_replace(
          regexp_replace(${outcomeHeadline}, '<mark>|</mark>', '', 'g'),
          ${Prisma.raw(`'\\y(${regexEscapedQuery})(\\w*)'`)}::text,
          ${`'<mark>\\1</mark>\\2'`}::text,
          'gi'
        )`
      : outcomeHeadline;
    const learningsHighlightExpr = useWordSimilarity
      ? Prisma.sql`regexp_replace(
          regexp_replace(${learningsHeadline}, '<mark>|</mark>', '', 'g'),
          ${Prisma.raw(`'\\y(${regexEscapedQuery})(\\w*)'`)}::text,
          ${`'<mark>\\1</mark>\\2'`}::text,
          'gi'
        )`
      : learningsHeadline;

    const rows = await this.prisma.$queryRaw<TrigramResultRow[]>`
      SELECT 
        c.id, 
        GREATEST(${simExpr1}, ${simExpr2}, ${simExpr3}, ${simExpr4}) AS rank,
        ${problemHighlightExpr} AS problem_highlight,
        ${solutionHighlightExpr} AS solution_highlight,
        ${outcomeHighlightExpr} AS outcome_highlight,
        ${learningsHighlightExpr} AS learnings_highlight
      FROM "contributions" c
      WHERE GREATEST(${simExpr1}, ${simExpr2}, ${simExpr3}, ${simExpr4}) > ${similarityThreshold}
        AND c.status::text = ${status}
        ${prefixFilter}
        ${projectFilter}
      ORDER BY rank DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    this.logSlowQuery('trigram', searchQuery, Date.now() - startTime);
    return { rows, total };
  }

  // ---------------------------------------------------------------------------
  // Hydration & response building
  // ---------------------------------------------------------------------------

  /**
   * Fetches full contribution data for each search row, preserving rank order.
   */
  private async hydrateResults(
    rows: SearchResultRow[] | TrigramResultRow[],
  ): Promise<SearchContributionItemDto[]> {
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);

    const contributions = await this.prisma.contribution.findMany({
      where: { id: { in: ids } },
      select: CONTRIBUTION_SELECT_FIELDS,
    });

    const contributionMap = new Map(contributions.map((c) => [c.id, c]));

    const results: SearchContributionItemDto[] = [];
    for (const row of rows) {
      const contribution = contributionMap.get(row.id);
      if (!contribution) continue;

      const decompressed = this.contentProcessing.decompressContribution(contribution);

      results.push({
        contribution: decompressed as ContributionResponseDto,
        rank: Number(row.rank),
        highlights: {
          problem: row.problem_highlight,
          solution: row.solution_highlight,
          outcome: row.outcome_highlight,
          learnings: row.learnings_highlight,
        },
      });
    }

    return results;
  }

  private buildResponse(
    data: SearchContributionItemDto[],
    total: number,
    page: number,
    limit: number,
    query: string,
    fallbackUsed: boolean,
  ): SearchContributionsResponseDto {
    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data,
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      query,
      fallbackUsed,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private logSlowQuery(type: string, query: string, durationMs: number): void {
    if (durationMs > 100) {
      this.logger.warn(`Slow ${type} query (${durationMs}ms) for: "${query}"`);
    }
  }
}
