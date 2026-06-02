import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, message } = this.classifyException(exception);

    const safeMessage =
      typeof message === 'string'
        ? message
        : (message as Record<string, unknown>).message || 'An error occurred';

    const safeExtras =
      typeof message === 'object' && message !== null
        ? {
            ...(typeof (message as Record<string, unknown>).error === 'string' && {
              error: (message as Record<string, unknown>).error,
            }),
            ...(Array.isArray((message as Record<string, unknown>).message) && {
              errors: (message as Record<string, unknown>).message,
            }),
            ...(typeof (message as Record<string, unknown>).field === 'string' && {
              field: (message as Record<string, unknown>).field,
            }),
          }
        : {};

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message: safeMessage,
      ...safeExtras,
    };

    this.logException(request, status, exception, errorResponse);
    response.status(status).json(errorResponse);
  }

  /**
   * Classify an exception into an HTTP status and user-facing message.
   * Keeps the main catch() method focused on building the response.
   */
  private classifyException(exception: unknown): {
    status: number;
    message: string | object;
  } {
    // NestJS HttpException
    if (exception instanceof HttpException) {
      return { status: exception.getStatus(), message: exception.getResponse() };
    }

    // Prisma: known request errors (constraint violations, etc.)
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.handlePrismaKnownError(exception);
    }

    // Prisma: DB connection / initialization failures
    if (exception instanceof Prisma.PrismaClientInitializationError) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Service temporarily unavailable. Please try again later.',
      };
    }

    // Prisma: validation errors (bad query)
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'Invalid request. Please check your input and try again.',
      };
    }

    // Prisma: internal engine panic
    if (exception instanceof Prisma.PrismaClientRustPanicError) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'An unexpected error occurred. Please try again later.',
      };
    }

    // Prisma: unknown request error
    if (exception instanceof Prisma.PrismaClientUnknownRequestError) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'An unexpected error occurred. Please try again later.',
      };
    }

    // Generic Error handling
    if (exception instanceof Error) {
      return this.classifyGenericError(exception);
    }

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' };
  }

  /**
   * Classify generic Error instances (payload too large, DB connection, etc.)
   */
  private classifyGenericError(error: Error): { status: number; message: string | object } {
    if (
      error.name === 'PayloadTooLargeError' ||
      error.message?.includes('request entity too large')
    ) {
      return {
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        message: {
          error: 'Payload Too Large',
          message: 'The request payload is too large. Maximum allowed size is 10MB.',
          details:
            'Please reduce the size of your content, especially if you have large images or text.',
        },
      };
    }

    if (this.isDatabaseConnectionError(error)) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Service temporarily unavailable. Please try again later.',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred. Please try again later.',
    };
  }

  /** Log exception at appropriate level based on status code */
  private logException(
    request: Request,
    status: number,
    exception: unknown,
    errorResponse: object,
  ): void {
    if (status >= (HttpStatus.INTERNAL_SERVER_ERROR as number)) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : JSON.stringify(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} - ${JSON.stringify(errorResponse)}`);
    }
  }

  /**
   * Map Prisma known error codes to user-friendly HTTP responses.
   * Full error is still logged server-side; only clean messages reach the client.
   * @see https://www.prisma.io/docs/orm/reference/error-reference#prisma-client-query-engine
   */
  private handlePrismaKnownError(error: Prisma.PrismaClientKnownRequestError): {
    status: number;
    message: string;
  } {
    switch (error.code) {
      // Unique constraint violation
      case 'P2002': {
        const target = (error.meta?.target as string[])?.join(', ') || 'field';
        return {
          status: HttpStatus.CONFLICT,
          message: `A record with this ${target} already exists.`,
        };
      }
      // Foreign key constraint violation
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'The referenced record does not exist.',
        };
      // Record not found
      case 'P2001':
      case 'P2018':
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'The requested record was not found.',
        };
      // Value too long for column
      case 'P2000':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'The provided value is too long for this field.',
        };
      // Required field missing
      case 'P2011':
      case 'P2012':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'A required field is missing.',
        };
      // Connection errors (pool exhausted, timeout, etc.)
      case 'P2024':
        return {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Service temporarily unavailable. Please try again later.',
        };
      // Default: hide internals
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'An unexpected error occurred. Please try again later.',
        };
    }
  }

  /**
   * Detect database connection errors from generic Error instances
   * (e.g. errors that don't come through as Prisma-typed exceptions).
   */
  private isDatabaseConnectionError(error: Error): boolean {
    const msg = error.message?.toLowerCase() ?? '';
    return (
      msg.includes('database') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('etimedout') ||
      msg.includes('max clients reached') ||
      (msg.includes('connection') && msg.includes('refused')) ||
      (msg.includes('pool') && msg.includes('timeout')) ||
      msg.includes("can't reach database server") ||
      msg.includes('error querying the database')
    );
  }
}
