import { CanActivate, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { getAppEnv, isProductionEnv } from '../environment';

/**
 * Blocks an endpoint unless the server is running in a non-production
 * environment (staging / development). On production it throws a hard
 * 403 Forbidden, so destructive QA-only routes (e.g. payroll period purge)
 * can never be reached in the production pipeline even if a route is exposed.
 */
@Injectable()
export class StagingOnlyGuard implements CanActivate {
  private readonly logger = new Logger(StagingOnlyGuard.name);

  canActivate(): boolean {
    if (isProductionEnv()) {
      this.logger.warn(
        `Blocked staging-only endpoint in '${getAppEnv()}' environment (production-gated)`,
      );
      throw new ForbiddenException(
        'This operation is only available in non-production environments',
      );
    }
    return true;
  }
}
