import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PgBossService } from '../../queue/pg-boss.service';
import { LeaveModifiedEvent } from '../events';
import { leaveModifiedTemplate } from '../templates';

/**
 * Email handler for non-workflow leave lifecycle events.
 *
 * Workflow-aligned events (submitted, team-lead reviewed, approved, rejected,
 * returned, cancelled) are now emailed by [workflow-notification.handler.ts](src/workflows/listeners/workflow-notification.handler.ts)
 * which fans out via the dynamic-workflow templates. This handler retains only
 * `leave.modified` — HR editing an already-approved leave, which sits outside
 * the approval workflow.
 */
@Injectable()
export class LeaveEmailHandler {
  private readonly logger = new Logger(LeaveEmailHandler.name);

  constructor(private readonly pgBossService: PgBossService) {}

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
