import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PgBossService } from '../../queue/pg-boss.service';
import { RequestContextService } from '../../common/services/request-context.service';
import {
  LeaveApprovedEvent,
  LeaveDeletedEvent,
  LeaveModifiedEvent,
  LeaveRejectedEvent,
  LeaveSubmittedEvent,
  LeaveTeamLeadReviewedEvent,
} from '../events';
import { LeaveStatus } from '@prisma/client';

@Injectable()
export class LeaveAuditHandler {
  private readonly logger = new Logger(LeaveAuditHandler.name);

  constructor(
    private readonly pgBossService: PgBossService,
    private readonly requestContext: RequestContextService,
  ) {}

  @OnEvent('leave.submitted', { async: true })
  async handleLeaveSubmitted(event: LeaveSubmittedEvent) {
    this.logger.log(`Queueing audit log for leave submission: ${event.leaveRequestId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.employeeId,
      action: 'LEAVE_SUBMITTED',
      entityType: 'LeaveRequest',
      entityId: event.leaveRequestId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        leaveType: event.leaveType,
        startDate: event.startDate.toISOString(),
        endDate: event.endDate.toISOString(),
        daysConsumed: event.daysConsumed,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('leave.teamLeadReviewed', { async: true })
  async handleTeamLeadReviewed(event: LeaveTeamLeadReviewedEvent) {
    const action =
      event.decision === LeaveStatus.TEAM_LEAD_APPROVED
        ? 'LEAVE_TEAM_LEAD_APPROVED'
        : 'LEAVE_TEAM_LEAD_REJECTED';

    this.logger.log(`Queueing audit log for team lead review (${action}): ${event.leaveRequestId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.teamLeadId,
      action,
      entityType: 'LeaveRequest',
      entityId: event.leaveRequestId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        employeeId: event.employeeId,
        employeeName: event.employeeName,
        decision: event.decision,
        comment: event.comment,
        leaveType: event.leaveType,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('leave.approved', { async: true })
  async handleLeaveApproved(event: LeaveApprovedEvent) {
    this.logger.log(`Queueing audit log for final leave approval: ${event.leaveRequestId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.hrId,
      action: 'LEAVE_APPROVED',
      entityType: 'LeaveRequest',
      entityId: event.leaveRequestId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        employeeId: event.employeeId,
        employeeName: event.employeeName,
        leaveType: event.leaveType,
        startDate: event.startDate.toISOString(),
        endDate: event.endDate.toISOString(),
        daysConsumed: event.daysConsumed,
        comment: event.comment,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('leave.modified', { async: true })
  async handleLeaveModified(event: LeaveModifiedEvent) {
    this.logger.log(`Queueing audit log for HR leave modification: ${event.leaveRequestId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.hrId,
      action: 'LEAVE_MODIFIED',
      entityType: 'LeaveRequest',
      entityId: event.leaveRequestId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        employeeId: event.employeeId,
        employeeName: event.employeeName,
        previousLeaveType: event.previousLeaveType,
        newLeaveType: event.newLeaveType,
        previousStartDate: event.previousStartDate.toISOString(),
        newStartDate: event.newStartDate.toISOString(),
        previousEndDate: event.previousEndDate.toISOString(),
        newEndDate: event.newEndDate.toISOString(),
        previousDaysConsumed: event.previousDaysConsumed,
        newDaysConsumed: event.newDaysConsumed,
        previousStatus: event.previousStatus,
        newStatus: event.newStatus,
        comment: event.comment,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('leave.rejected', { async: true })
  async handleLeaveRejected(event: LeaveRejectedEvent) {
    this.logger.log(`Queueing audit log for final leave rejection: ${event.leaveRequestId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.hrId,
      action: 'LEAVE_REJECTED',
      entityType: 'LeaveRequest',
      entityId: event.leaveRequestId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        employeeId: event.employeeId,
        employeeName: event.employeeName,
        leaveType: event.leaveType,
        comment: event.comment,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('leave.deleted', { async: true })
  async handleLeaveDeleted(event: LeaveDeletedEvent) {
    this.logger.log(`Queueing audit log for permanent leave deletion: ${event.leaveRequestId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.hrId,
      action: 'LEAVE_DELETED',
      entityType: 'LeaveRequest',
      entityId: event.leaveRequestId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        employeeId: event.employeeId,
        employeeName: event.employeeName,
        leaveType: event.leaveType,
        previousStatus: event.status,
        startDate: event.startDate.toISOString(),
        endDate: event.endDate.toISOString(),
        daysConsumed: event.daysConsumed,
        balanceReversed: event.balanceReversed,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }
}
