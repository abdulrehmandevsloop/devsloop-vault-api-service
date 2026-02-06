import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Standard API response wrapper for success responses
 * Use this for consistent API responses across all endpoints
 */
export class StandardResponseDto<T = any> {
  @ApiProperty({ description: 'Indicates if the request was successful', example: true })
  success: boolean;

  @ApiProperty({ description: 'Response data' })
  data: T;

  @ApiPropertyOptional({ description: 'Optional success message' })
  message?: string;

  @ApiPropertyOptional({ description: 'Optional metadata (pagination, timestamps, etc.)' })
  meta?: Record<string, any>;

  constructor(data: T, message?: string, meta?: Record<string, any>) {
    this.success = true;
    this.data = data;
    this.message = message;
    this.meta = meta;
  }
}

/**
 * Standard paginated response wrapper
 * Extends StandardResponseDto with pagination metadata
 */
export class PaginatedResponseDto<T = any> extends StandardResponseDto<T[]> {
  @ApiProperty({ description: 'Total number of items', example: 100 })
  total: number;

  @ApiProperty({ description: 'Current page number', example: 1 })
  page: number;

  @ApiProperty({ description: 'Items per page', example: 10 })
  limit: number;

  @ApiProperty({ description: 'Total number of pages', example: 10 })
  totalPages: number;

  @ApiProperty({ description: 'Whether there is a next page', example: true })
  hasNextPage: boolean;

  @ApiProperty({ description: 'Whether there is a previous page', example: false })
  hasPreviousPage: boolean;

  constructor(data: T[], total: number, page: number, limit: number, message?: string) {
    super(data, message);
    this.total = total;
    this.page = page;
    this.limit = limit;
    this.totalPages = Math.ceil(total / limit) || 1;
    this.hasNextPage = page < this.totalPages;
    this.hasPreviousPage = page > 1;
  }
}

/**
 * Standard error response format
 * Used by HttpExceptionFilter (already implemented)
 * Documented here for reference
 */
export class ErrorResponseDto {
  @ApiProperty({ description: 'HTTP status code', example: 400 })
  statusCode: number;

  @ApiProperty({ description: 'Error message', example: 'Validation error' })
  message: string | string[];

  @ApiProperty({ description: 'Error type', example: 'Bad Request' })
  error: string;

  @ApiPropertyOptional({ description: 'Request timestamp' })
  timestamp?: string;

  @ApiPropertyOptional({ description: 'Request path' })
  path?: string;

  @ApiPropertyOptional({ description: 'HTTP method' })
  method?: string;
}
