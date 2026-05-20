import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PgBossService } from '../../queue/pg-boss.service';
import {
  LeaveApprovedEvent,
  LeaveModifiedEvent,
  LeaveRejectedEvent,
  LeaveSubmittedEvent,
  LeaveTeamLeadReviewedEvent,
} from '../events';
import { PrismaService } from '../../prisma';
import {
  leaveApprovedTemplate,
  leaveModifiedTemplate,
  leaveRejectedTemplate,
  leaveSubmittedTemplate,
  leaveTeamLeadReviewedTemplate,
} from '../templates';

@Injectable()
export class LeaveEmailHandler {
  private readonly logger = new Logger(LeaveEmailHandler.name);

  constructor(
    private readonly pgBossService: PgBossService,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent('leave.submitted', { async: true })
  async handleLeaveSubmitted(event: LeaveSubmittedEvent): Promise<void> {
    this.logger.log(
      `Sending leave submission notification to reporting manager ${event.reportingManagerEmail} for employee ${event.employeeEmail}`,
    );

    const email = leaveSubmittedTemplate(event);

    await this.pgBossService.sendToQueue('email-notification', {
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  }

  @OnEvent('leave.teamLeadReviewed', { async: true })
  async handleTeamLeadReviewed(event: LeaveTeamLeadReviewedEvent): Promise<void> {
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
                some: { entity: { name: 'user', isActive: true } },
              },
            },
          },
        },
      },
      select: { id: true, email: true, name: true },
    });

    if (!hrUsers.length) {
      this.logger.warn(
        `No HR users found; skipping team lead review email for leave ${event.leaveRequestId}`,
      );
      return;
    }

    const email = leaveTeamLeadReviewedTemplate(event);

    await Promise.all(
      hrUsers.map((hr) =>
        this.pgBossService.sendToQueue('email-notification', {
          to: hr.email,
          subject: email.subject,
          html: email.html(hr.name ?? 'HR'),
          text: email.text,
        }),
      ),
    );
  }

  @OnEvent('leave.approved', { async: true })
  async handleLeaveApproved(event: LeaveApprovedEvent): Promise<void> {
    this.logger.log(`Sending final approval email to ${event.employeeEmail}`);

    const email = leaveApprovedTemplate(event);

    await this.pgBossService.sendToQueue('email-notification', {
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  }

  @OnEvent('leave.rejected', { async: true })
  async handleLeaveRejected(event: LeaveRejectedEvent): Promise<void> {
    this.logger.log(`Sending final rejection email to ${event.employeeEmail}`);

    const email = leaveRejectedTemplate(event);

    await this.pgBossService.sendToQueue('email-notification', {
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  }

  @OnEvent('leave.modified', { async: true })
  async handleLeaveModified(event: LeaveModifiedEvent): Promise<void> {
    this.logger.log(
      `Sending leave modification email to ${event.employeeEmail} for leave ${event.leaveRequestId}`,
    );

    const email = leaveModifiedTemplate(event);

    await this.pgBossService.sendToQueue('email-notification', {
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  }
}
