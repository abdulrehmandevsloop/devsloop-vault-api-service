import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ProjectCreatedEvent, ProjectUpdatedEvent, ProjectDeletedEvent } from '../events';
import { PgBossService } from '../../queue/pg-boss.service';
import { RequestContextService } from '../../common/services/request-context.service';

@Injectable()
export class ProjectAuditHandler {
  private readonly logger = new Logger(ProjectAuditHandler.name);

  constructor(
    private readonly pgBossService: PgBossService,
    private readonly requestContext: RequestContextService,
  ) {}

  @OnEvent('project.created', { async: true })
  async handleProjectCreated(event: ProjectCreatedEvent) {
    this.logger.log(`Queueing audit log for project creation: ${event.projectId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.adminId,
      action: 'PROJECT_CREATED',
      entityType: 'Project',
      entityId: event.projectId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        projectName: event.projectName,
        clientName: event.clientName,
        domain: event.domain,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('project.updated', { async: true })
  async handleProjectUpdated(event: ProjectUpdatedEvent) {
    this.logger.log(`Queueing audit log for project update: ${event.projectId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.adminId,
      action: 'PROJECT_UPDATED',
      entityType: 'Project',
      entityId: event.projectId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        projectName: event.projectName,
        changedFields: event.changedFields,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('project.deleted', { async: true })
  async handleProjectDeleted(event: ProjectDeletedEvent) {
    this.logger.log(`Queueing audit log for project deletion: ${event.projectId}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.adminId,
      action: 'PROJECT_DELETED',
      entityType: 'Project',
      entityId: event.projectId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        projectName: event.projectName,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }
}
