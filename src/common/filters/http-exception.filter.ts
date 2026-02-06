import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = 'Internal server error';

    // Handle HttpException
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.getResponse();
    }
    // Handle PayloadTooLargeError from body-parser
    else if (exception instanceof Error && exception.name === 'PayloadTooLargeError') {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      message = {
        error: 'Payload Too Large',
        message: 'The request payload is too large. Maximum allowed size is 10MB.',
        details:
          'Please reduce the size of your content, especially if you have large images or text.',
      };
    }
    // Handle other known errors
    else if (exception instanceof Error) {
      // Check for specific error types by name or message
      if (exception.message?.includes('request entity too large')) {
        status = HttpStatus.PAYLOAD_TOO_LARGE;
        message = {
          error: 'Payload Too Large',
          message: 'The request payload is too large. Maximum allowed size is 10MB.',
          details:
            'Please reduce the size of your content, especially if you have large images or text.',
        };
      } else {
        message = exception.message || 'Internal server error';
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
}
