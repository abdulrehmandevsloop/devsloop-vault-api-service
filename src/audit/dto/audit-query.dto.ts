import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';

export class AuditQueryDto {
  @ApiPropertyOptional({
    description: 'Search across action, entityType, entityId, user name/email',
  })
  @IsOptional()
  @IsString({ message: 'Search query must be a string' })
  @MaxLength(255, { message: 'Search query must not exceed 255 characters' })
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by action type (e.g. LOGIN, REGISTER)' })
  @IsOptional()
  @IsString({ message: 'Action must be a string' })
  @MaxLength(100, { message: 'Action must not exceed 100 characters' })
  action?: string;

  @ApiPropertyOptional({ description: 'Filter by entity type (e.g. User, Contribution)' })
  @IsOptional()
  @IsString({ message: 'Entity type must be a string' })
  @MaxLength(100, { message: 'Entity type must not exceed 100 characters' })
  entityType?: string;

  @ApiPropertyOptional({ description: 'Filter by specific user ID' })
  @IsOptional()
  @IsString({ message: 'User ID must be a string' })
  @MaxLength(100, { message: 'User ID must not exceed 100 characters' })
  userId?: string;

  @ApiPropertyOptional({
    description: 'Filter logs from this date (ISO 8601)',
    example: '2024-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  @ApiPropertyOptional({
    description: 'Filter logs until this date (ISO 8601)',
    example: '2024-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['timestamp', 'action', 'entityType'],
    default: 'timestamp',
  })
  @IsOptional()
  @IsString({ message: 'Sort field must be a string' })
  @MaxLength(50, { message: 'Sort field must not exceed 50 characters' })
  sortBy?: string = 'timestamp';

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsString({ message: 'Sort order must be a string' })
  @MaxLength(10, { message: 'Sort order must not exceed 10 characters' })
  sortOrder?: 'asc' | 'desc' = 'desc';
}
