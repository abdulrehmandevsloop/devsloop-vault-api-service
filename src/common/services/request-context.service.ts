import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  /**
   * Run a callback within a request context.
   * Called by the middleware for every incoming HTTP request.
   */
  run(context: RequestContext, callback: () => void) {
    this.storage.run(context, callback);
  }

  /**
   * Get the current request's IP address (if available).
   */
  getIpAddress(): string | undefined {
    return this.storage.getStore()?.ipAddress;
  }

  /**
   * Get the current request's user agent (if available).
   */
  getUserAgent(): string | undefined {
    return this.storage.getStore()?.userAgent;
  }
}
