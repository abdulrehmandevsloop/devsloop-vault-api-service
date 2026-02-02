import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALLOW_PENDING_KEY } from '../decorators/allow-pending.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    // Check if endpoint allows pending users BEFORE calling parent handler
    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Call parent handler (validates token and loads user)
    const result = super.handleRequest(err, user, info, context);

    // If user exists and endpoint doesn't allow pending users, check approval status
    if (result && !allowPending) {
      if (result.approvalStatus !== 'APPROVED') {
        throw new UnauthorizedException('User account is not approved');
      }
    }

    return result;
  }
}
