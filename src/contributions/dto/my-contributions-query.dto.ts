import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { ContributionStatus } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * Query params for GET /api/v1/contributions/my.
 * Returns paginated list of contributions created by the current user.
 * Filter by status (optional) - if omitted, returns all contributions.
 */
export class MyContributionsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description:
      'Filter by status: DRAFT, SUBMITTED (pending), APPROVED, REJECTED. ' +
      'Omit to return all statuses.',
    enum: ContributionStatus,
  })
  @IsOptional()
  @IsEnum(ContributionStatus, {
    message: 'status must be one of: DRAFT, SUBMITTED, APPROVED, REJECTED',
  })
  status?: ContributionStatus;

  // Inherits page and limit from PaginationDto
  // Override default limit to 20 (instead of 10)
  limit?: number = 20;
}
