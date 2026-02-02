import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_EMAIL_VERIFIED_KEY } from '../decorators/require-email-verified.decorator';

/**
 * Guard that ensures the user has verified their email address
 * Use with @RequireEmailVerified() decorator on routes that require email verification
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requireEmailVerified = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_EMAIL_VERIFIED_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If route doesn't require email verification, allow access
    if (!requireEmailVerified) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // User should already be authenticated by JwtAuthGuard
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    // Check if email is verified
    if (!user.emailVerified) {
      throw new ForbiddenException(
        'Please verify your email address to access this resource. Check your inbox for the verification link.',
      );
    }

    return true;
  }
}
