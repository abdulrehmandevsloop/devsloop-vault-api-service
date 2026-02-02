import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ContributionSubmittedEvent,
  ContributionApprovedEvent,
  ContributionRejectedEvent,
} from '../events';
import { PgBossService } from '../../queue/pg-boss.service';

@Injectable()
export class ContributionEmailHandler {
  private readonly logger = new Logger(ContributionEmailHandler.name);

  constructor(private readonly pgBossService: PgBossService) {}

  @OnEvent('contribution.submitted', { async: true })
  async handleContributionSubmitted(event: ContributionSubmittedEvent) {
    this.logger.log(`Queueing submission confirmation email for ${event.userEmail}`);

    await this.pgBossService.sendToQueue('email-notification', {
      to: event.userEmail,
      subject: 'DevsLoop Vault - Contribution Submitted',
      html: `
        <h1>Contribution Submitted Successfully</h1>
        <p>Your contribution for project "${event.projectName}" has been submitted for review.</p>
        <p>You will be notified once a reviewer processes your submission.</p>
        <p>Thank you for contributing to the knowledge base!</p>
      `,
    });
  }

  @OnEvent('contribution.approved', { async: true })
  async handleContributionApproved(event: ContributionApprovedEvent) {
    this.logger.log(`Queueing approval email for ${event.userEmail}`);

    await this.pgBossService.sendToQueue('email-notification', {
      to: event.userEmail,
      subject: 'DevsLoop Vault - Contribution Approved! 🎉',
      html: `
        <h1>Contribution Approved!</h1>
        <p>Great news! Your contribution has been approved by ${event.reviewerName}.</p>
        <p>Your contribution is now part of the DevsLoop Vault knowledge base.</p>
        <p>Keep up the great work!</p>
      `,
    });
  }

  @OnEvent('contribution.rejected', { async: true })
  async handleContributionRejected(event: ContributionRejectedEvent) {
    this.logger.log(`Queueing rejection email for ${event.userEmail}`);

    await this.pgBossService.sendToQueue('email-notification', {
      to: event.userEmail,
      subject: 'DevsLoop Vault - Contribution Needs Revision',
      html: `
        <h1>Contribution Review Update</h1>
        <p>Your contribution has been reviewed by ${event.reviewerName}.</p>
        <p>The contribution requires some revisions before it can be approved.</p>
        ${event.reviewComments ? `<p><strong>Review Comments:</strong><br>${event.reviewComments}</p>` : ''}
        <p>Please review the feedback and submit an updated version.</p>
      `,
    });
  }
}
