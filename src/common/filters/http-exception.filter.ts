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

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = 'Internal server error';

    // ─── NestJS HttpException ─────────────────────────────────────────
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.getResponse();
    }

    // ─── Prisma: known request errors (constraint violations, etc.) ──
    else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const result = this.handlePrismaKnownError(exception);
      status = result.status;
      message = result.message;
    }

    // ─── Prisma: DB connection / initialization failures ─────────────
    else if (exception instanceof Prisma.PrismaClientInitializationError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      message = 'Service temporarily unavailable. Please try again later.';
    }

    // ─── Prisma: validation errors (bad query) ───────────────────────
    else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid request. Please check your input and try again.';
    }

    // ─── Prisma: internal engine panic ───────────────────────────────
    else if (exception instanceof Prisma.PrismaClientRustPanicError) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'An unexpected error occurred. Please try again later.';
    }

    // ─── Prisma: unknown request error ───────────────────────────────
    else if (exception instanceof Prisma.PrismaClientUnknownRequestError) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'An unexpected error occurred. Please try again later.';
    }

    // ─── PayloadTooLargeError from body-parser ───────────────────────
    else if (exception instanceof Error && exception.name === 'PayloadTooLargeError') {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      message = {
        error: 'Payload Too Large',
        message: 'The request payload is too large. Maximum allowed size is 10MB.',
        details:
          'Please reduce the size of your content, especially if you have large images or text.',
      };
    }

    // ─── Other generic errors ────────────────────────────────────────
    else if (exception instanceof Error) {
      if (exception.message?.includes('request entity too large')) {
        status = HttpStatus.PAYLOAD_TOO_LARGE;
        message = {
          error: 'Payload Too Large',
          message: 'The request payload is too large. Maximum allowed size is 10MB.',
          details:
            'Please reduce the size of your content, especially if you have large images or text.',
        };
      } else if (this.isDatabaseConnectionError(exception)) {
        status = HttpStatus.SERVICE_UNAVAILABLE;
        message = 'Service temporarily unavailable. Please try again later.';
      } else {
        // Generic fallback — never expose raw error messages to clients
        message = 'An unexpected error occurred. Please try again later.';
      }
    }

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message: typeof message === 'string' ? message : (message as any).message || message,
      ...(typeof message === 'object' && message !== null ? message : {}),
    };

    // Always log the full error internally for debugging
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : JSON.stringify(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} - ${JSON.stringify(errorResponse)}`);
    }

    response.status(status).json(errorResponse);
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
