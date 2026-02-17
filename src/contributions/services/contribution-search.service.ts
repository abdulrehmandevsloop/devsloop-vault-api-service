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
}

/** Raw row from the trigram fallback query. */
interface TrigramResultRow {
  id: string;
  rank: number;
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
    currentUserId: string,
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
      const items = await this.hydrateResults(
        trgm.rows.map((row) => ({
          ...row,
          problem_highlight: null,
          solution_highlight: null,
        })),
      );
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

    // Build project filter condition - use Prisma.sql with array parameter
    const projectFilter =
      projectIds && projectIds.length > 0
        ? Prisma.sql`AND c."projectId" = ANY(${projectIds}::text[])`
        : Prisma.empty;

    const [{ count }] = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count
      FROM "contributions" c, websearch_to_tsquery('english', ${searchQuery}) query
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
        ts_headline('english', strip_html(c.solution), query,
          ${`MaxWords=50, MinWords=20, ${HEADLINE_OPTIONS}`}) AS solution_highlight
      FROM "contributions" c, websearch_to_tsquery('english', ${searchQuery}) query
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

    const [{ count }] = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count
      FROM "contributions" c
      WHERE c.problem % ${searchQuery}
        AND c.status::text = ${status}
        ${projectFilter}
    `;
    const total = Number(count);

    if (total === 0) return { rows: [], total: 0 };

    const rows = await this.prisma.$queryRaw<TrigramResultRow[]>`
      SELECT c.id, similarity(c.problem, ${searchQuery}) AS rank
      FROM "contributions" c
      WHERE c.problem % ${searchQuery}
        AND c.status::text = ${status}
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
  private async hydrateResults(rows: SearchResultRow[]): Promise<SearchContributionItemDto[]> {
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
