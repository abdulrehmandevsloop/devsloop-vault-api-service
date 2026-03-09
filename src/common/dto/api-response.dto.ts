import { ApiProperty } from '@nestjs/swagger';
import { HttpStatus } from '@nestjs/common';

/**
 * Standard API response wrapper for all responses
 */
export class ApiResponseDto<T = any> {
  @ApiProperty({ description: 'Indicates if the request was successful', example: true })
  success: boolean;

  @ApiProperty({ description: 'Response message', example: 'Success' })
  message: string;

  @ApiProperty({ description: 'Response data', type: Object })
  data: T;

  @ApiProperty({ description: 'HTTP status code', example: HttpStatus.OK })
  statusCode: number;
}

/**
 * Pagination metadata for list responses
 */
export class PaginationMeta {
  @ApiProperty({ description: 'Total number of items', example: 100 })
  total: number;

  @ApiProperty({ description: 'Current page number', example: 1 })
  page: number;

  @ApiProperty({ description: 'Number of items per page', example: 10 })
  limit: number;

  @ApiProperty({ description: 'Total number of pages', example: 10 })
  totalPages: number;

  @ApiProperty({ description: 'Whether there is a next page', example: true })
  hasNextPage: boolean;

  @ApiProperty({ description: 'Whether there is a previous page', example: false })
  hasPreviousPage: boolean;
}

/**
 * Paginated response for list endpoints
 */
export class PaginatedResponseDto<T = any> extends ApiResponseDto<T> {
  @ApiProperty({ description: 'Pagination metadata', type: PaginationMeta })
  pagination: PaginationMeta;
}

/**
 * Worklog statistics response
 */
export class WorklogStatsDto {
  @ApiProperty({ description: 'Total worklogs count', example: 150 })
  totalWorklogs: number;

  @ApiProperty({ description: 'Total hours worked', example: 1200.5 })
  totalHours: number;

  @ApiProperty({ description: 'Active contributors count', example: 25 })
  activeContributors: number;

  @ApiProperty({ description: 'Projects with worklogs', example: 8 })
  projectsWithWorklogs: number;

  @ApiProperty({ description: 'Worklogs today', example: 12 })
  todayCount: number;

  @ApiProperty({ description: 'Hours logged today', example: 96.5 })
  todayHours: number;

  @ApiProperty({ description: 'Worklogs this week', example: 85 })
  weekCount: number;

  @ApiProperty({ description: 'Hours logged this week', example: 680.25 })
  weekHours: number;
}
