import { ApiProperty } from '@nestjs/swagger';
import { HttpStatus } from '@nestjs/common';

/**
 * Standard API response wrapper for all responses
 */

export class ApiResponseDto<T> {
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
