import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles are required, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    // If user is not authenticated, throw UnauthorizedException
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    // Collect all user role names from UserRoleAssignment (single source of truth)
    const userRoleNames: string[] = [];
    if (user.userRoleAssignments && Array.isArray(user.userRoleAssignments)) {
      user.userRoleAssignments.forEach(
        (assignment: { role?: { name?: string }; isPrimary?: boolean }) => {
          if (assignment.role?.name && !userRoleNames.includes(assignment.role.name)) {
            userRoleNames.push(assignment.role.name);
          }
        },
      );
    }

    // Check if ADMIN is required and user is a system user with ADMIN role
    const requiresAdmin = requiredRoles.includes('ADMIN');
    if (requiresAdmin && user.isSystem === true) {
      const hasAdminRole = userRoleNames.some((name) => name === 'ADMIN' || name === 'SYSTEM');
      if (hasAdminRole) {
        return true;
      }
    }

    // Filter out ADMIN from required roles for dynamic role check
    const dynamicRequiredRoles = requiredRoles.filter((role) => role !== 'ADMIN');

    // If only ADMIN was required and user doesn't have it, deny access
    if (dynamicRequiredRoles.length === 0 && requiresAdmin) {
      throw new ForbiddenException(
        `Access denied. Required role: ADMIN (system role). Your roles: ${userRoleNames.join(', ') || 'NONE'}`,
      );
    }

    // Check if user has one of the required dynamic roles
    const hasRequiredRole = dynamicRequiredRoles.some((requiredRole) =>
      userRoleNames.includes(requiredRole),
    );

    if (!hasRequiredRole && dynamicRequiredRoles.length > 0) {
      throw new ForbiddenException(
        `Access denied. Required role: ${dynamicRequiredRoles.join(' or ')}. Your roles: ${userRoleNames.join(', ') || 'NONE'}`,
      );
    }

    // Note: Entity-based access is checked separately by EntityAccessGuard
    // This guard only checks role membership
    return true;
  }
}
