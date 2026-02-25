import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  IsArray,
} from 'class-validator';

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
    description:
      'Filter by project ID(s). Can be a single project ID or multiple project IDs as an array.',
    example: 'clx1234567890',
    type: [String],
    isArray: true,
  })
  @IsOptional()
  @Transform(({ value }) => {
    // Handle both single value and array from query params
    // Express may give us a string for single value or array for multiple values
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    if (Array.isArray(value)) {
      // Filter out empty strings and return non-empty array or undefined
      const filtered = value.filter((v) => v && v.trim().length > 0);
      return filtered.length > 0 ? filtered : undefined;
    }
    // Single string value - wrap in array
    if (typeof value === 'string' && value.trim().length > 0) {
      return [value];
    }
    return undefined;
  })
  @IsArray({ message: 'Project IDs must be an array' })
  @IsString({ each: true, message: 'Each project ID must be a string' })
  @MaxLength(100, { each: true, message: 'Each project ID must not exceed 100 characters' })
  projectIds?: string[];

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
