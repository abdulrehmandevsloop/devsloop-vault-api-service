import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AclService } from '../../rbac/rbac.service';
import { ENTITY_KEY } from '../decorators/require-entity.decorator';

@Injectable()
export class EntityAccessGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private aclService: AclService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get required entities from decorator (can be string or string[])
    const requiredEntities = this.reflector.getAllAndOverride<string | string[]>(ENTITY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no entity is required, allow access
    if (!requiredEntities) {
      return true;
    }

    // Normalize to array format
    const entityArray = Array.isArray(requiredEntities) ? requiredEntities : [requiredEntities];

    const { user } = context.switchToHttp().getRequest();

    // If user is not authenticated, throw UnauthorizedException
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    // PURE ENTITY-BASED ACCESS CONTROL
    // All users (including admins) must have explicit entity permissions
    // No role-based bypass - access is granted solely based on entity permissions

    // Check if user has access to ANY of the required entities (OR logic)
    // User needs access to at least one entity in the list
    const accessChecks = await Promise.all(
      entityArray.map((entity) => this.aclService.userHasEntityAccess(user.id as string, entity)),
    );

    const hasAccess = accessChecks.some((hasAccess) => hasAccess === true);

    if (!hasAccess) {
      const entityList = entityArray.join(', ');
      throw new ForbiddenException(
        `Access denied. You do not have permission to access any of the required entities: ${entityList}.`,
      );
    }

    return true;
  }
}
