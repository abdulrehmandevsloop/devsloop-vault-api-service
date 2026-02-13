import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Query params for GET /api/v1/contributions/search
 * Full-text search across APPROVED contribution content.
 * Status is hardcoded to APPROVED — only approved contributions are searchable.
 */
export class SearchContributionsQueryDto {
  @ApiProperty({
    description: 'Search query text (supports phrases with quotes, exclusion with -, OR operator)',
    example: 'kubernetes deployment',
    minLength: 2,
    maxLength: 200,
  })
  @IsString({ message: 'Search query must be a string' })
  @MinLength(2, { message: 'Search query must be at least 2 characters' })
  @MaxLength(200, { message: 'Search query must not exceed 200 characters' })
  q: string;

  @ApiPropertyOptional({
    description: 'Filter by project ID',
    example: 'clx1234567890',
  })
  @IsOptional()
  @IsString({ message: 'Project ID must be a string' })
  @MaxLength(100, { message: 'Project ID must not exceed 100 characters' })
  projectId?: string;

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
