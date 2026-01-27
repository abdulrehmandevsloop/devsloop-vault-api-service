import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TokenCleanupService {
  private readonly logger = new Logger(TokenCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Clean up expired email verification tokens daily at midnight
   * This keeps the database clean and removes stale verification tokens
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupExpiredVerificationTokens() {
    this.logger.log('Starting cleanup of expired email verification tokens...');

    try {
      const result = await this.prisma.user.updateMany({
        where: {
          emailVerified: false,
          emailVerificationExpires: {
            lt: new Date(),
          },
        },
        data: {
          emailVerificationToken: null,
          emailVerificationExpires: null,
        },
      });

      this.logger.log(`✅ Cleaned up ${result.count} expired email verification token(s)`);
    } catch (error) {
      this.logger.error('❌ Failed to cleanup expired verification tokens', error);
    }
  }

  /**
   * Clean up expired password reset tokens daily at midnight
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupExpiredPasswordResetTokens() {
    this.logger.log('Starting cleanup of expired password reset tokens...');

    try {
      const result = await this.prisma.user.updateMany({
        where: {
          passwordResetExpires: {
            lt: new Date(),
          },
        },
        data: {
          passwordResetToken: null,
          passwordResetExpires: null,
        },
      });

      this.logger.log(`✅ Cleaned up ${result.count} expired password reset token(s)`);
    } catch (error) {
      this.logger.error('❌ Failed to cleanup expired password reset tokens', error);
    }
  }

  /**
   * Manual cleanup method (can be called via admin endpoint if needed)
   */
  async cleanupExpiredTokens(): Promise<{
    verificationTokens: number;
    resetTokens: number;
  }> {
    const [verificationResult, resetResult] = await Promise.all([
      this.prisma.user.updateMany({
        where: {
          emailVerified: false,
          emailVerificationExpires: {
            lt: new Date(),
          },
        },
        data: {
          emailVerificationToken: null,
          emailVerificationExpires: null,
        },
      }),
      this.prisma.user.updateMany({
        where: {
          passwordResetExpires: {
            lt: new Date(),
          },
        },
        data: {
          passwordResetToken: null,
          passwordResetExpires: null,
        },
      }),
    ]);

    return {
      verificationTokens: verificationResult.count,
      resetTokens: resetResult.count,
    };
  }
}
