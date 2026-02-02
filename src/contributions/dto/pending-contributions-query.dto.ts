import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';
import { ContributionStatus } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * Query params for GET /api/v1/contributions/reviewer.
 * Filter by project (projectId) and/or status. By default, shows pending (SUBMITTED) only.
 * Supports pagination with page and limit parameters.
 */
export class PendingContributionsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filter by project ID (must be a project the reviewer is assigned to)',
    example: 'clx1234567890',
  })
  @IsOptional()
  @IsString({ message: 'Project ID must be a string' })
  @MaxLength(100, { message: 'Project ID must not exceed 100 characters' })
  projectId?: string;

  @ApiPropertyOptional({
    description:
      'Filter by status: SUBMITTED (pending), APPROVED (approved), REJECTED (rejected). ' +
      'Default: SUBMITTED (pending) if omitted.',
    enum: ContributionStatus,
  })
  @IsOptional()
  @IsEnum(ContributionStatus, {
    message: 'status must be one of: SUBMITTED, APPROVED, REJECTED',
  })
  status?: ContributionStatus;

  @ApiPropertyOptional({ default: 1, minimum: 1, description: 'Page number' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, description: 'Items per page' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
