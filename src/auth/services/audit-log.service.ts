import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestContextService } from '../../common/services/request-context.service';

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  /**
   * Create audit log entry for authentication events
   */
  async log(
    userId: string | null,
    action: string,
    entityType: string,
    entityId: string,
    changes: Record<string, any>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          entityType,
          entityId,
          changes,
          ipAddress: this.requestContext.getIpAddress() ?? null,
          userAgent: this.requestContext.getUserAgent() ?? null,
          timestamp: new Date(),
        },
      });
    } catch (error) {
      // Log error but don't fail the operation
      this.logger.error(`Failed to create audit log: ${error}`);
    }
  }

  /**
   * Log user registration
   */
  async logRegistration(userId: string, email: string): Promise<void> {
    await this.log(userId, 'REGISTER', 'User', userId, {
      email,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Log user login
   */
  async logLogin(userId: string, email: string): Promise<void> {
    await this.log(userId, 'LOGIN', 'User', userId, {
      email,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Log user logout
   */
  async logLogout(userId: string, email: string): Promise<void> {
    await this.log(userId, 'LOGOUT', 'User', userId, {
      email,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Log forgot password request
   */
  async logForgotPasswordRequest(userId: string, email: string): Promise<void> {
    await this.log(userId, 'FORGOT_PASSWORD_REQUEST', 'User', userId, {
      email,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Log password reset
   */
  async logPasswordReset(userId: string, email: string): Promise<void> {
    await this.log(userId, 'PASSWORD_RESET', 'User', userId, {
      email,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Log password change
   */
  async logPasswordChange(userId: string, email: string): Promise<void> {
    await this.log(userId, 'PASSWORD_CHANGED', 'User', userId, {
      email,
      timestamp: new Date().toISOString(),
    });
  }
}
