import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'your-secret-key',
    });
  }

  async validate(payload: { sub: string; email: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        isSystem: true,
        userRoleAssignments: {
          where: {
            role: {
              isActive: true,
            },
          },
          select: {
            isPrimary: true,
            role: {
              select: {
                id: true,
                name: true,
                displayName: true,
              },
            },
          },
        },
        departments: true,
        avatarUrl: true,
        emailVerified: true,
        hasAccess: true,
        approvalStatus: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Check if user has access
    if (user.hasAccess === 0) {
      throw new UnauthorizedException('User account does not have access');
    }

    // Note: Approval status check is handled in JwtAuthGuard
    // to allow pending users access to specific endpoints (e.g., /me)

    return user;
  }
}
