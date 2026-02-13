import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  UserRegisteredEvent,
  UserLoggedInEvent,
  UserLoggedOutEvent,
  PasswordResetRequestedEvent,
  PasswordResetCompletedEvent,
  PasswordChangedEvent,
} from '../events';
import { PgBossService } from '../../queue/pg-boss.service';
import { RequestContextService } from '../../common/services/request-context.service';

@Injectable()
export class UserAuditHandler {
  private readonly logger = new Logger(UserAuditHandler.name);

  constructor(
    private readonly pgBossService: PgBossService,
    private readonly requestContext: RequestContextService,
  ) {}

  @OnEvent('user.registered', { async: true })
  async handleUserRegistered(event: UserRegisteredEvent) {
    this.logger.log(`Queueing audit log for user registration: ${event.userId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.userId,
      action: 'REGISTER',
      entityType: 'User',
      entityId: event.userId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        email: event.email,
        name: event.name,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('user.logged-in', { async: true })
  async handleUserLoggedIn(event: UserLoggedInEvent) {
    this.logger.log(`Queueing audit log for user login: ${event.userId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.userId,
      action: 'LOGIN',
      entityType: 'User',
      entityId: event.userId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        email: event.email,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('user.logged-out', { async: true })
  async handleUserLoggedOut(event: UserLoggedOutEvent) {
    this.logger.log(`Queueing audit log for user logout: ${event.userId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.userId,
      action: 'LOGOUT',
      entityType: 'User',
      entityId: event.userId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        email: event.email,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('password.reset-requested', { async: true })
  async handlePasswordResetRequested(event: PasswordResetRequestedEvent) {
    this.logger.log(`Queueing audit log for password reset request: ${event.email}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: 'system',
      action: 'PASSWORD_RESET_REQUESTED',
      entityType: 'User',
      entityId: event.email,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        email: event.email,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('password.reset-completed', { async: true })
  async handlePasswordResetCompleted(event: PasswordResetCompletedEvent) {
    this.logger.log(`Queueing audit log for password reset completed: ${event.userId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.userId,
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'User',
      entityId: event.userId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        email: event.email,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('password.changed', { async: true })
  async handlePasswordChanged(event: PasswordChangedEvent) {
    this.logger.log(`Queueing audit log for password change: ${event.userId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.userId,
      action: 'PASSWORD_CHANGED',
      entityType: 'User',
      entityId: event.userId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        email: event.email,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }
}
