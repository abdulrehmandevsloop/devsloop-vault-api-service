import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AclService } from '../../rbac/rbac.service';
import { ENTITY_KEY } from '../decorators/require-entity.decorator';
import { AuditLogService } from '../../auth/services/audit-log.service';

@Injectable()
export class EntityAccessGuard implements CanActivate {
  private readonly logger = new Logger(EntityAccessGuard.name);

  constructor(
    private reflector: Reflector,
    private aclService: AclService,
    private auditLogService: AuditLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get required entity from decorator
    const requiredEntity = this.reflector.getAllAndOverride<string>(ENTITY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no entity is required, allow access
    if (!requiredEntity) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    // If user is not authenticated, throw UnauthorizedException
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    // System roles (e.g., ADMIN) have access to all entities
    // Check primary role first
    if (user.role?.isSystem === true) {
      return true;
    }

    // Check all assigned roles for system role
    if (user.userRoleAssignments && Array.isArray(user.userRoleAssignments)) {
      const hasSystemRole = user.userRoleAssignments.some(
        (assignment) => assignment.role?.isSystem === true,
      );
      if (hasSystemRole) {
        return true;
      }
    }

    // Check if user has access to the required entity (ACL entries take priority over roles)
    const hasAccess = await this.aclService.userHasEntityAccess(user.id, requiredEntity);

    if (!hasAccess) {
      // Get request details for audit logging
      const request = context.switchToHttp().getRequest();
      const method = request.method;
      const url = request.url;

      // Log permission denial for security monitoring
      this.auditLogService
        .log(user.id, 'PERMISSION_DENIED', 'EntityAccess', requiredEntity, {
          entity: requiredEntity,
          endpoint: `${method} ${url}`,
          reason: 'No entity permission',
          timestamp: new Date().toISOString(),
        })
        .catch((error) => {
          // Log error but don't fail the request
          this.logger.error(`Failed to log permission denial: ${error}`);
        });

      throw new ForbiddenException(
        `Access denied. You do not have permission to access the "${requiredEntity}" entity.`,
      );
    }

    return true;
  }
}
