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

/**
 * Prisma.raw literal for status comparison.
 * Using the enum cast (instead of ::text) lets the planner match the partial
 * index predicate: WHERE status = 'APPROVED'.
 */
const APPROVED_STATUS = Prisma.raw(`'APPROVED'::"ContributionStatus"`);

/** Raw row from the full-text search query (includes window-function total). */
interface SearchResultRow {
  id: string;
  rank: number;
  total_count: bigint;
  problem_highlight: string | null;
  solution_highlight: string | null;
  outcome_highlight: string | null;
  learnings_highlight: string | null;
}

/** Raw row from the trigram fallback query (includes window-function total). */
interface TrigramResultRow {
  id: string;
  rank: number;
  total_count: bigint;
  problem_highlight: string | null;
  solution_highlight: string | null;
  outcome_highlight: string | null;
  learnings_highlight: string | null;
}

@Injectable()
export class ContributionSearchService {
  private readonly logger = new Logger(ContributionSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contentProcessing: ContentProcessingService,
  ) {}

  /**
   * Search approved contributions via full-text search with trigram fallback.
   *
   * Phase 1: Full-text search (websearch_to_tsquery + partial GIN-indexed tsvector).
   * Phase 2: Trigram similarity fallback on the problem field if Phase 1 yields nothing.
   *
   * Both phases use a single SQL query with COUNT(*) OVER() to avoid a separate
   * count round-trip. Status comparisons use enum casting so the planner can
   * use the partial indexes (WHERE status = 'APPROVED').
   */
  async search(
    query: SearchContributionsQueryDto,
    _currentUserId: string,
  ): Promise<SearchContributionsResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;
    const searchQuery = query.q.trim();
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
      const items = await this.hydrateResults(trgm.rows);
      return this.buildResponse(items, trgm.total, page, limit, searchQuery, true);
    }

    return this.buildResponse([], 0, page, limit, searchQuery, false);
  }

  // ---------------------------------------------------------------------------
  // Phase 1: Full-text search
  // ---------------------------------------------------------------------------

  private async fullTextSearch(
    searchQuery: string,
    projectIds: string[] | null,
    limit: number,
    offset: number,
  ): Promise<{ rows: SearchResultRow[]; total: number }> {
    const startTime = Date.now();

    const projectFilter =
      projectIds && projectIds.length > 0
        ? Prisma.sql`AND c."projectId" = ANY(${projectIds}::text[])`
        : Prisma.empty;

    // websearch_to_tsquery is:
    //   - Safe: never throws on malformed input (unlike to_tsquery)
    //   - Natural: "foo bar" = AND, "foo OR bar" = OR, "-foo" = NOT, '"foo bar"' = phrase
    //   - Parameterized: no SQL injection risk
    //   - Stemmed: "deployment" matches "deploy", "deploying", etc.
    //
    // COUNT(*) OVER() returns total matching rows without a separate count query.
    // ts_rank_cd flag 32 normalises rank by document length for fairer ranking.
    //
    // The partial GIN index (WHERE status = 'APPROVED') is used because the
    // status comparison uses the enum type directly (not ::text cast).
    const rows = await this.prisma.$queryRaw<SearchResultRow[]>`
      SELECT
        c.id,
        ts_rank_cd(c.search_vector, query, 32) AS rank,
        ts_headline('english', c.problem, query,
          ${`MaxWords=35, MinWords=15, ${HEADLINE_OPTIONS}`}) AS problem_highlight,
        ts_headline('english', strip_html(COALESCE(c.solution, '')), query,
          ${`MaxWords=50, MinWords=20, ${HEADLINE_OPTIONS}`}) AS solution_highlight,
        ts_headline('english', strip_html(COALESCE(c.outcome, '')), query,
          ${`MaxWords=50, MinWords=20, ${HEADLINE_OPTIONS}`}) AS outcome_highlight,
        ts_headline('english', strip_html(COALESCE(c.learnings, '')), query,
          ${`MaxWords=50, MinWords=20, ${HEADLINE_OPTIONS}`}) AS learnings_highlight,
        COUNT(*) OVER() AS total_count
      FROM "contributions" c,
           websearch_to_tsquery('english', ${searchQuery}) AS query
      WHERE c.search_vector @@ query
        AND c.status = ${APPROVED_STATUS}
        ${projectFilter}
      ORDER BY rank DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    this.logSlowQuery('FTS', searchQuery, Date.now() - startTime);
    return { rows, total };
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Trigram fallback
  // ---------------------------------------------------------------------------

  private async trigramSearch(
    searchQuery: string,
    projectIds: string[] | null,
    limit: number,
    offset: number,
  ): Promise<{ rows: TrigramResultRow[]; total: number }> {
    const startTime = Date.now();

    const projectFilter =
      projectIds && projectIds.length > 0
        ? Prisma.sql`AND c."projectId" = ANY(${projectIds}::text[])`
        : Prisma.empty;

    // WHERE clause uses GIN-index-supported operators on the `problem` column:
    //   ${q} <<% c.problem  →  word_similarity(q, problem) >= pg_trgm.word_similarity_threshold
    //                           best for prefix-like matches ("kube" → "kubernetes")
    //   c.problem % ${q}    →  similarity(problem, q)      >= pg_trgm.similarity_threshold
    //                           best for whole-word typo tolerance ("deploymant" → "deployment")
    //
    // The partial trigram GIN index on `problem` (WHERE status = 'APPROVED') is used
    // because the status comparison uses the enum type directly.
    //
    // Highlights use plainto_tsquery for approximate word-boundary marking.
    // They won't highlight typos but still show the matched excerpt.
    const tsHighlightQuery = Prisma.sql`plainto_tsquery('english', ${searchQuery})`;

    const rows = await this.prisma.$queryRaw<TrigramResultRow[]>`
      SELECT
        c.id,
        GREATEST(
          word_similarity(${searchQuery}, c.problem),
          similarity(c.problem, ${searchQuery})
        ) AS rank,
        ts_headline('english', c.problem, ${tsHighlightQuery},
          ${`MaxWords=35, MinWords=15, ${HEADLINE_OPTIONS}`}) AS problem_highlight,
        ts_headline('english', strip_html(COALESCE(c.solution, '')), ${tsHighlightQuery},
          ${`MaxWords=50, MinWords=20, ${HEADLINE_OPTIONS}`}) AS solution_highlight,
        ts_headline('english', strip_html(COALESCE(c.outcome, '')), ${tsHighlightQuery},
          ${`MaxWords=50, MinWords=20, ${HEADLINE_OPTIONS}`}) AS outcome_highlight,
        ts_headline('english', strip_html(COALESCE(c.learnings, '')), ${tsHighlightQuery},
          ${`MaxWords=50, MinWords=20, ${HEADLINE_OPTIONS}`}) AS learnings_highlight,
        COUNT(*) OVER() AS total_count
      FROM "contributions" c
      WHERE (
        ${searchQuery} <<% c.problem
        OR c.problem % ${searchQuery}
      )
      AND c.status = ${APPROVED_STATUS}
      ${projectFilter}
      ORDER BY rank DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
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
