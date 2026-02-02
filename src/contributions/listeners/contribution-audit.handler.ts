import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ContributionSubmittedEvent,
  ContributionApprovedEvent,
  ContributionRejectedEvent,
} from '../events';
import { PgBossService } from '../../queue/pg-boss.service';

@Injectable()
export class ContributionAuditHandler {
  private readonly logger = new Logger(ContributionAuditHandler.name);

  constructor(private readonly pgBossService: PgBossService) {}

  @OnEvent('contribution.submitted', { async: true })
  async handleContributionSubmitted(event: ContributionSubmittedEvent) {
    this.logger.log(`Queueing audit log for contribution submission: ${event.contributionId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.authorId,
      action: 'CONTRIBUTION_SUBMITTED',
      entityType: 'Contribution',
      entityId: event.contributionId,
      changes: {
        projectId: event.projectId,
        projectName: event.projectName,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('contribution.approved', { async: true })
  async handleContributionApproved(event: ContributionApprovedEvent) {
    this.logger.log(`Queueing audit log for contribution approval: ${event.contributionId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.reviewerId,
      action: 'CONTRIBUTION_APPROVED',
      entityType: 'Contribution',
      entityId: event.contributionId,
      changes: {
        authorId: event.authorId,
        reviewerId: event.reviewerId,
        reviewerName: event.reviewerName,
        projectId: event.projectId,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('contribution.rejected', { async: true })
  async handleContributionRejected(event: ContributionRejectedEvent) {
    this.logger.log(`Queueing audit log for contribution rejection: ${event.contributionId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.reviewerId,
      action: 'CONTRIBUTION_REJECTED',
      entityType: 'Contribution',
      entityId: event.contributionId,
      changes: {
        authorId: event.authorId,
        reviewerId: event.reviewerId,
        reviewerName: event.reviewerName,
        reviewerComment: event.reviewerComment,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }
}
