import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContributionResponseDto } from './contribution-response.dto';

class SearchHighlightsDto {
  @ApiPropertyOptional({
    description: 'Problem field with matched terms wrapped in <mark> tags',
  })
  problem: string | null;

  @ApiPropertyOptional({
    description: 'Solution field snippet with matched terms wrapped in <mark> tags',
  })
  solution: string | null;
}

/**
 * A single search result item with relevance rank and highlighted snippets.
 */
export class SearchContributionItemDto {
  @ApiProperty({ type: ContributionResponseDto, description: 'Full contribution data' })
  contribution: ContributionResponseDto;

  @ApiProperty({ description: 'Relevance rank score (higher = more relevant)', example: 0.85 })
  rank: number;

  @ApiProperty({ description: 'Highlighted snippets with <mark> tags for matched terms' })
  highlights: SearchHighlightsDto;
}

/**
 * Response for GET /api/v1/contributions/search
 */
export class SearchContributionsResponseDto {
  @ApiProperty({ type: [SearchContributionItemDto], description: 'Search results' })
  data: SearchContributionItemDto[];

  @ApiProperty({ description: 'Total number of matching contributions' })
  total: number;

  @ApiProperty({ description: 'Current page number' })
  page: number;

  @ApiProperty({ description: 'Number of items per page' })
  limit: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages: number;

  @ApiProperty({ description: 'Whether there is a next page' })
  hasNextPage: boolean;

  @ApiProperty({ description: 'Whether there is a previous page' })
  hasPreviousPage: boolean;

  @ApiProperty({ description: 'The search query that was executed' })
  query: string;

  @ApiProperty({
    description: 'Whether the trigram fallback search was used (true = typo-tolerant mode)',
  })
  fallbackUsed: boolean;
}
