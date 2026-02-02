import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UserApprovedEvent, UserRejectedEvent, UserStatusChangedEvent } from '../events';
import { PgBossService } from '../../queue/pg-boss.service';

@Injectable()
export class UserAuditHandler {
  private readonly logger = new Logger(UserAuditHandler.name);

  constructor(private readonly pgBossService: PgBossService) {}

  @OnEvent('user.approved', { async: true })
  async handleUserApproved(event: UserApprovedEvent) {
    this.logger.log(`Queueing audit log for user approval: ${event.userId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.approvedBy,
      action: 'USER_APPROVED',
      entityType: 'User',
      entityId: event.userId,
      changes: {
        email: event.email,
        name: event.name,
        previousStatus: event.previousStatus,
        newStatus: event.newStatus,
        approvedBy: event.approvedBy,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('user.rejected', { async: true })
  async handleUserRejected(event: UserRejectedEvent) {
    this.logger.log(`Queueing audit log for user rejection: ${event.userId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.rejectedBy,
      action: 'USER_REJECTED',
      entityType: 'User',
      entityId: event.userId,
      changes: {
        email: event.email,
        name: event.name,
        reason: event.reason,
        rejectedBy: event.rejectedBy,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('user.status-changed', { async: true })
  async handleUserStatusChanged(event: UserStatusChangedEvent) {
    this.logger.log(`Queueing audit log for user status change: ${event.userId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.adminId,
      action: 'USER_STATUS_CHANGED',
      entityType: 'User',
      entityId: event.userId,
      changes: {
        email: event.email,
        name: event.name,
        previousStatus: event.previousStatus === 1 ? 'has access' : 'no access',
        newStatus: event.newStatus === 1 ? 'has access' : 'no access',
        changedBy: event.adminId,
        timestamp: new Date().toISOString(),
      },
    });
  }
}
