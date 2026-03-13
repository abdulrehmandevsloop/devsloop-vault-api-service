import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PgBossService } from '../../queue/pg-boss.service';
import {
  LeaveApprovedEvent,
  LeaveRejectedEvent,
  LeaveSubmittedEvent,
  LeaveTeamLeadReviewedEvent,
} from '../events';
import { LeaveStatus } from '@prisma/client';
import { PrismaService } from '../../prisma';

@Injectable()
export class LeaveEmailHandler {
  private readonly logger = new Logger(LeaveEmailHandler.name);

  constructor(
    private readonly pgBossService: PgBossService,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent('leave.submitted', { async: true })
  async handleLeaveSubmitted(event: LeaveSubmittedEvent) {
    this.logger.log(
      `Sending leave submission notification to reporting manager ${event.reportingManagerEmail} for employee ${event.employeeEmail}`,
    );

    const dateRange =
      event.startDate.toDateString() === event.endDate.toDateString()
        ? event.startDate.toDateString()
        : `${event.startDate.toDateString()} – ${event.endDate.toDateString()}`;

    await this.pgBossService.sendToQueue('email-notification', {
      to: event.reportingManagerEmail,
      subject: `Leave Request Submitted for Your Review – ${event.employeeName}`,
      html: `
        <p>Hi ${event.reportingManagerName},</p>
        <p>You have a new <strong>${event.leaveType.replace(
          '_',
          ' ',
        )}</strong> leave request to review from <strong>${event.employeeName}</strong> (${event.employeeEmail}).</p>
        <ul>
          <li><strong>Dates:</strong> ${dateRange}</li>
          <li><strong>Days requested:</strong> ${event.daysConsumed}</li>
        </ul>
        <p>Please review and take action in the Devsloop Vault leave management dashboard.</p>
        <p>Regards,<br/>Devsloop HR</p>
      `,
    });
  }

  @OnEvent('leave.teamLeadReviewed', { async: true })
  async handleTeamLeadReviewed(event: LeaveTeamLeadReviewedEvent) {
    const isApproved = event.decision === LeaveStatus.TEAM_LEAD_APPROVED;

    this.logger.log(
      `Sending team lead review notification to HR for leave ${event.leaveRequestId} (${event.decision})`,
    );

    const hrUsers = await this.prisma.user.findMany({
      where: {
        isSystem: false,
        employeeStatus: 'ACTIVE',
        userRoleAssignments: {
          some: {
            role: {
              isActive: true,
              roleEntities: {
                some: {
                  entity: {
                    name: 'user',
                    isActive: true,
                  },
                },
              },
            },
          },
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });

    if (!hrUsers.length) {
      this.logger.warn(
        `No HR users with access to 'user' entity found; skipping team lead review email for leave ${event.leaveRequestId}`,
      );
      return;
    }

    const decisionLabel = isApproved ? 'approved' : 'rejected';
    const subject = isApproved
      ? `Leave Request Awaiting HR Review – ${event.employeeName}`
      : `Leave Request Rejected by Team Lead – ${event.employeeName}`;

    const dateRange =
      event.startDate.toDateString() === event.endDate.toDateString()
        ? event.startDate.toDateString()
        : `${event.startDate.toDateString()} – ${event.endDate.toDateString()}`;

    const htmlBody = (hrName: string) => `
      <p>Hi ${hrName},</p>
      <p>The following leave request has been <strong>${decisionLabel}</strong> by Team Lead <strong>${event.teamLeadName}</strong> and ${
        isApproved ? 'is now awaiting your HR review.' : 'may require your attention.'
      }</p>
      <ul>
        <li><strong>Employee:</strong> ${event.employeeName} (${event.employeeEmail})</li>
        <li><strong>Leave type:</strong> ${event.leaveType.replace('_', ' ')}</li>
        <li><strong>Dates:</strong> ${dateRange}</li>
        <li><strong>Team Lead decision:</strong> ${decisionLabel.toUpperCase()}</li>
        <li><strong>Team Lead comment:</strong> ${event.comment || '—'}</li>
      </ul>
      <p>Please open the Leave Management screen in Devsloop Vault to review this request.</p>
      <p>Regards,<br/>Devsloop HR</p>
    `;

    await Promise.all(
      hrUsers.map((hr) =>
        this.pgBossService.sendToQueue('email-notification', {
          to: hr.email,
          subject,
          html: htmlBody(hr.name ?? 'HR'),
        }),
      ),
    );
  }

  @OnEvent('leave.approved', { async: true })
  async handleLeaveApproved(event: LeaveApprovedEvent) {
    this.logger.log(`Sending final approval email to ${event.employeeEmail}`);

    const dateRange =
      event.startDate.toDateString() === event.endDate.toDateString()
        ? event.startDate.toDateString()
        : `${event.startDate.toDateString()} – ${event.endDate.toDateString()}`;

    await this.pgBossService.sendToQueue('email-notification', {
      to: event.employeeEmail,
      subject: `Leave Request Approved ✓`,
      html: `
        <p>Hi ${event.employeeName},</p>
        <p>Your <strong>${event.leaveType.replace('_', ' ')}</strong> leave request has been <strong style="color: #22c55e;">fully approved</strong> by HR.</p>
        <ul>
          <li><strong>Dates:</strong> ${dateRange}</li>
          <li><strong>Days deducted:</strong> ${event.daysConsumed}</li>
          <li><strong>HR Comment:</strong> ${event.comment}</li>
        </ul>
        <p>Enjoy your time off!</p>
        <p>Regards,<br/>Devsloop HR</p>
      `,
    });
  }

  @OnEvent('leave.rejected', { async: true })
  async handleLeaveRejected(event: LeaveRejectedEvent) {
    this.logger.log(`Sending final rejection email to ${event.employeeEmail}`);

    const dateRange =
      event.startDate.toDateString() === event.endDate.toDateString()
        ? event.startDate.toDateString()
        : `${event.startDate.toDateString()} – ${event.endDate.toDateString()}`;

    await this.pgBossService.sendToQueue('email-notification', {
      to: event.employeeEmail,
      subject: `Leave Request Rejected`,
      html: `
        <p>Hi ${event.employeeName},</p>
        <p>Your <strong>${event.leaveType.replace('_', ' ')}</strong> leave request for <strong>${dateRange}</strong> has been <strong style="color: #ef4444;">rejected by HR</strong>.</p>
        <p><strong>Reason:</strong> ${event.comment}</p>
        <p>Please contact HR if you have any questions.</p>
        <p>Regards,<br/>Devsloop HR</p>
      `,
    });
  }
}
