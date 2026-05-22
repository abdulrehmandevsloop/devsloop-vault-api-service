import { Injectable, Logger } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Generate access and refresh tokens for a user
   */
  async generateTokens(
    userId: string,
    email: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = { sub: userId, email };

    const accessTokenExpiresIn = (this.configService.get<string>('JWT_EXPIRES_IN') ||
      '15m') as StringValue;
    const refreshTokenExpiresIn = (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ||
      '7d') as StringValue;

    const accessTokenOptions: JwtSignOptions = {
      secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      expiresIn: accessTokenExpiresIn,
    };

    const refreshTokenOptions: JwtSignOptions = {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: refreshTokenExpiresIn,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, accessTokenOptions),
      this.jwtService.signAsync(payload, refreshTokenOptions),
    ]);

    return { accessToken, refreshToken };
  }

  /**
   * Verify refresh token
   */
  verifyRefreshToken(token: string) {
    return this.jwtService.verify(token, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
    });
  }

  /**
   * Store hashed refresh token in database
   */
  async storeRefreshToken(userId: string, refreshToken: string): Promise<void> {
    const hashedToken = await bcrypt.hash(refreshToken, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashedToken },
    });
  }

  /**
   * Verify stored refresh token matches provided token
   */
  async verifyStoredToken(userId: string, refreshToken: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { refreshToken: true },
    });

    if (!user || !user.refreshToken) {
      return false;
    }

    return bcrypt.compare(refreshToken, user.refreshToken);
  }

  /**
   * Invalidate all refresh tokens for a user (logout)
   */
  async invalidateRefreshTokens(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
    this.logger.log(`Invalidated refresh tokens for user ${userId}`);
  }
}
