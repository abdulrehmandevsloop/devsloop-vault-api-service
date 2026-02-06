import { ApiProperty } from '@nestjs/swagger';
import { ContributionResponseDto } from './contribution-response.dto';

export class ReviewerContributionsResponseDto {
  @ApiProperty({ type: [ContributionResponseDto], description: 'List of contributions' })
  contributions: ContributionResponseDto[];

  @ApiProperty({ description: 'Count of pending (SUBMITTED) contributions' })
  pending: number;

  @ApiProperty({ description: 'Count of approved (APPROVED) contributions' })
  approved: number;

  @ApiProperty({ description: 'Count of rejected (REJECTED) contributions' })
  rejected: number;

  @ApiProperty({ description: 'Total number of contributions matching the filter' })
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
}
