import { Injectable, HttpStatus, HttpException } from '@nestjs/common';

@Injectable()
export class ResponseService {
  success<T>(data?: T, message = 'Success', statusCode = HttpStatus.OK) {
    return {
      success: true,
      message,
      data,
      statusCode,
    };
  }

  created<T>(data: T, message = 'Resource created successfully') {
    return {
      success: true,
      message,
      data,
      statusCode: HttpStatus.CREATED,
    };
  }

  error(message: string, statusCode = HttpStatus.BAD_REQUEST) {
    throw new HttpException(
      {
        success: false,
        message,
        data: null,
        statusCode,
      },
      statusCode,
    );
  }

  // Common error helpers
  notFound(message = 'Not found') {
    this.error(message, HttpStatus.NOT_FOUND);
  }

  badRequest(message = 'Bad request') {
    this.error(message, HttpStatus.BAD_REQUEST);
  }

  unauthorized(message = 'Unauthorized') {
    this.error(message, HttpStatus.UNAUTHORIZED);
  }

  forbidden(message = 'Forbidden') {
    this.error(message, HttpStatus.FORBIDDEN);
  }

  // Success with pagination
  paginatedSuccess<T>(
    data: T,
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    },
    message = 'Success',
  ) {
    return {
      success: true,
      message,
      data: { data, pagination },
      statusCode: HttpStatus.OK,
    };
  }
}
