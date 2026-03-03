import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ContributionCreatedEvent,
  ContributionSubmittedEvent,
  ContributionApprovedEvent,
  ContributionRejectedEvent,
  ContributionUpdatedEvent,
  ContributionRevertedToDraftEvent,
  ContributionDeletedEvent,
} from '../events';
import { PgBossService } from '../../queue/pg-boss.service';
import { RequestContextService } from '../../common/services/request-context.service';

@Injectable()
export class ContributionAuditHandler {
  private readonly logger = new Logger(ContributionAuditHandler.name);

  constructor(
    private readonly pgBossService: PgBossService,
    private readonly requestContext: RequestContextService,
  ) {}

  @OnEvent('contribution.created', { async: true })
  async handleContributionCreated(event: ContributionCreatedEvent) {
    this.logger.log(`Queueing audit log for contribution creation: ${event.contributionId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.authorId,
      action: 'CONTRIBUTION_CREATED',
      entityType: 'Contribution',
      entityId: event.contributionId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        projectId: event.projectId,
        projectName: event.projectName,
        status: 'DRAFT',
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('contribution.submitted', { async: true })
  async handleContributionSubmitted(event: ContributionSubmittedEvent) {
    this.logger.log(`Queueing audit log for contribution submission: ${event.contributionId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.authorId,
      action: 'CONTRIBUTION_SUBMITTED',
      entityType: 'Contribution',
      entityId: event.contributionId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
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
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
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
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        authorId: event.authorId,
        reviewerId: event.reviewerId,
        reviewerName: event.reviewerName,
        reviewerComment: event.reviewerComment,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('contribution.updated', { async: true })
  async handleContributionUpdated(event: ContributionUpdatedEvent) {
    this.logger.log(`Queueing audit log for contribution update: ${event.contributionId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.authorId,
      action: 'CONTRIBUTION_UPDATED',
      entityType: 'Contribution',
      entityId: event.contributionId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        changedFields: event.changedFields,
        ...(event.projectId ? { projectId: event.projectId } : {}),
        ...(event.visibility ? { visibility: event.visibility } : {}),
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('contribution.reverted_to_draft', { async: true })
  async handleContributionRevertedToDraft(event: ContributionRevertedToDraftEvent) {
    this.logger.log(`Queueing audit log for contribution revert-to-draft: ${event.contributionId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.authorId,
      action: 'CONTRIBUTION_REVERTED_TO_DRAFT',
      entityType: 'Contribution',
      entityId: event.contributionId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('contribution.deleted', { async: true })
  async handleContributionDeleted(event: ContributionDeletedEvent) {
    this.logger.log(`Queueing audit log for contribution deletion: ${event.contributionId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.authorId,
      action: 'CONTRIBUTION_DELETED',
      entityType: 'Contribution',
      entityId: event.contributionId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        status: event.status,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }
}
