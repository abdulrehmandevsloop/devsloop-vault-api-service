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

    // Collect all user role names (primary role + assigned roles)
    const userRoleNames: string[] = [];

    // Add primary role if exists
    if (user.role?.name) {
      userRoleNames.push(user.role.name);
    }

    // Add all assigned roles from UserRoleAssignment
    if (user.userRoleAssignments && Array.isArray(user.userRoleAssignments)) {
      user.userRoleAssignments.forEach((assignment) => {
        if (assignment.role?.name && !userRoleNames.includes(assignment.role.name)) {
          userRoleNames.push(assignment.role.name);
        }
      });
    }

    // Check if user has one of the required roles
    const hasRequiredRole = requiredRoles.some((requiredRole) =>
      userRoleNames.includes(requiredRole),
    );

    if (!hasRequiredRole) {
      throw new ForbiddenException(
        `Access denied. Required role: ${requiredRoles.join(' or ')}. Your roles: ${userRoleNames.join(', ') || 'NONE'}`,
      );
    }

    return true;
  }
}
