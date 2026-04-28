import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PgBossService } from 'src/queue/pg-boss.service';
import { PrismaService } from 'src/prisma';
import { WorkflowStepCompletedEvent } from '../events';

@Injectable()
export class WorkflowNotificationHandler {
  private readonly logger = new Logger(WorkflowNotificationHandler.name);

  constructor(
    private readonly pgBossService: PgBossService,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent('workflow.step.completed', { async: true })
  async handleStepCompleted(event: WorkflowStepCompletedEvent) {
    if (event.resolution !== 'APPROVED') return;

    // Find the next PENDING step to notify its eligible approvers
    const nextStep = await this.prisma.workflowStepInstance.findFirst({
      where: {
        workflowInstance: { id: event.instanceId },
        resolution: 'PENDING',
      },
      orderBy: { stepOrder: 'asc' },
    });

    if (!nextStep || nextStep.eligibleApproverIds.length === 0) return;

    const approvers = await this.prisma.user.findMany({
      where: { id: { in: nextStep.eligibleApproverIds } },
      select: { id: true, email: true, name: true },
    });

    for (const approver of approvers) {
      this.logger.log(`Notifying approver ${approver.email} for step ${nextStep.stepOrder}`);
      await this.pgBossService.sendToQueue('email-notification', {
        to: approver.email,
        subject: `Action Required: ${nextStep.stepName}`,
        type: 'WORKFLOW_STEP_PENDING',
        data: {
          approverName: approver.name,
          stepName: nextStep.stepName,
          requestType: event.requestType,
          requestId: event.requestId,
        },
      });
    }
  }
}
