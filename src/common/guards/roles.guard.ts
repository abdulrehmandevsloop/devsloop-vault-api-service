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

    // Check if ADMIN is required and user has ADMIN system role
    const requiresAdmin = requiredRoles.includes('ADMIN');
    if (requiresAdmin) {
      // Check primary role for ADMIN system role
      if (user.role?.name === 'ADMIN' && user.role?.isSystem === true) {
        return true;
      }

      // Check assigned roles for ADMIN system role
      if (user.userRoleAssignments && Array.isArray(user.userRoleAssignments)) {
        const hasAdminSystemRole = user.userRoleAssignments.some(
          (assignment) => assignment.role?.name === 'ADMIN' && assignment.role?.isSystem === true,
        );
        if (hasAdminSystemRole) {
          return true;
        }
      }
    }

    // For non-ADMIN roles, check dynamic roles
    // Collect all user role names (primary role + assigned roles)
    const userRoleNames: string[] = [];

    // Add primary role if exists (only if not ADMIN or if ADMIN but not system)
    if (user.role?.name) {
      // Skip ADMIN if it's not a system role (shouldn't happen, but safety check)
      if (user.role.name !== 'ADMIN' || user.role.isSystem !== true) {
        userRoleNames.push(user.role.name);
      }
    }

    // Add all assigned roles from UserRoleAssignment
    if (user.userRoleAssignments && Array.isArray(user.userRoleAssignments)) {
      user.userRoleAssignments.forEach((assignment) => {
        if (assignment.role?.name && !userRoleNames.includes(assignment.role.name)) {
          // Skip ADMIN if it's not a system role
          if (assignment.role.name !== 'ADMIN' || assignment.role.isSystem !== true) {
            userRoleNames.push(assignment.role.name);
          }
        }
      });
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
