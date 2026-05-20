import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PgBossService } from 'src/queue/pg-boss.service';
import { RequestContextService } from 'src/common/services/request-context.service';
import { WorkflowCompletedEvent, WorkflowStepCompletedEvent } from '../events';

@Injectable()
export class WorkflowAuditHandler {
  private readonly logger = new Logger(WorkflowAuditHandler.name);

  constructor(
    private readonly pgBossService: PgBossService,
    private readonly requestContext: RequestContextService,
  ) {}

  @OnEvent('workflow.step.completed', { async: true })
  async handleStepCompleted(event: WorkflowStepCompletedEvent) {
    this.logger.log(
      `Audit: workflow step ${event.stepOrder} ${event.resolution} on instance ${event.instanceId}`,
    );

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.actorId ?? 'system',
      action: `WORKFLOW_STEP_${event.resolution}`,
      entityType: 'WorkflowStepInstance',
      entityId: event.instanceId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        requestType: event.requestType,
        requestId: event.requestId,
        stepOrder: event.stepOrder,
        stepName: event.stepName,
        resolution: event.resolution,
        comment: event.comment,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }

  @OnEvent('workflow.completed', { async: true })
  async handleCompleted(event: WorkflowCompletedEvent) {
    this.logger.log(`Audit: workflow ${event.instanceId} completed with ${event.resolution}`);

    await this.pgBossService.sendToQueue('audit-log', {
      userId: event.requesterId,
      action: `WORKFLOW_${event.resolution}`,
      entityType: 'WorkflowInstance',
      entityId: event.instanceId,
      ipAddress: this.requestContext.getIpAddress(),
      userAgent: this.requestContext.getUserAgent(),
      changes: {
        requestType: event.requestType,
        requestId: event.requestId,
        resolution: event.resolution,
        reason: event.reason,
        timestamp: event.timestamp.toISOString(),
      },
    });
  }
}
