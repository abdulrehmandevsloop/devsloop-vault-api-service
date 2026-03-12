import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class WorklogMonthQueryDto {
  @ApiProperty({
    description: 'Month in YYYY-MM format',
    example: '2025-02',
  })
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be in YYYY-MM format' })
  month: string;
}

export class ProjectWorklogsQueryDto {
  @ApiProperty({
    description: 'Month in YYYY-MM format',
    example: '2025-02',
  })
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be in YYYY-MM format' })
  month: string;

  @ApiPropertyOptional({
    description: 'Filter by specific user ID. Only MANAGER/QA/ADMIN can filter by other users.',
    example: 'clx1234567890abcdefghijkl',
  })
  @IsOptional()
  @IsString()
  userId?: string;
}

export class ExportWorklogQueryDto {
  @ApiPropertyOptional({
    description: 'User ID to export for (e.g. when exporting another user from team member page)',
    example: 'clx...',
  })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiProperty({ description: 'Month in YYYY-MM format', example: '2025-02' })
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be in YYYY-MM format' })
  month: string;

  @ApiPropertyOptional({
    description:
      'Project ID to filter by (used only when projectScope=present; ignored when projectScope=old)',
    example: 'clx...',
  })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({
    description:
      "Project scope: 'present' = active projects user is assigned to (use projectId filter). 'old' = projects user is not assigned to but has worklogs.",
    enum: ['present', 'old'],
    default: 'present',
  })
  @IsOptional()
  @IsIn(['present', 'old'], { message: "projectScope must be 'present' or 'old'" })
  projectScope?: 'present' | 'old' = 'present';
}

export class ProjectsComplianceQueryDto extends WorklogMonthQueryDto {
  @ApiPropertyOptional({
    description:
      'Project IDs to get compliance for (comma-separated). If omitted, returns compliance for all projects the user has access to.',
    example: 'clx...,clx...',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      : value,
  )
  @IsString({ each: true })
  projectIds?: string[];
}

export class UserWorklogsQueryDto extends WorklogMonthQueryDto {
  @ApiPropertyOptional({
    description:
      'Project IDs to get worklogs for (comma-separated). If omitted, returns worklogs for all projects the requester has access to for this user.',
    example: 'clx...,clx...',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      : (value ?? []),
  )
  @IsString({ each: true })
  projectIds?: string[];
}

export class ProjectComplianceQueryDto extends WorklogMonthQueryDto {
  @ApiPropertyOptional({ description: 'Page number (1-indexed)', default: 1, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 10, example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}
