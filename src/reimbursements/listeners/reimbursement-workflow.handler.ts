import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ReimbursementStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma';
import { WorkflowCompletedEvent, WorkflowStepCompletedEvent } from 'src/workflows/events';

@Injectable()
export class ReimbursementWorkflowHandler {
  private readonly logger = new Logger(ReimbursementWorkflowHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('workflow.step.completed', { async: true })
  async handleStepCompleted(event: WorkflowStepCompletedEvent) {
    if (event.requestType !== 'REIMBURSEMENT') return;
    if (event.resolution !== 'APPROVED') return;
    try {
      await this.prisma.reimbursementRequest.updateMany({
        where: { id: event.requestId, status: ReimbursementStatus.PENDING },
        data: { status: ReimbursementStatus.APPROVED },
      });
    } catch (err) {
      this.logger.error(
        `Failed to set APPROVED for reimbursement ${event.requestId}: ${String(err)}`,
      );
    }
  }

  @OnEvent('workflow.completed', { async: true })
  async handle(event: WorkflowCompletedEvent) {
    if (event.requestType !== 'REIMBURSEMENT') return;

    this.logger.log(
      `Handling workflow.completed for reimbursement ${event.requestId}: ${event.resolution}`,
    );

    try {
      const status = this.mapResolution(event.resolution);
      if (!status) return;

      await this.prisma.reimbursementRequest.update({
        where: { id: event.requestId },
        data: { status },
      });

      this.logger.log(`Reimbursement ${event.requestId} status updated to ${status}`);
    } catch (err) {
      this.logger.error(
        `Failed to sync reimbursement status for request ${event.requestId}: ${String(err)}`,
      );
    }
  }

  private mapResolution(resolution: string): ReimbursementStatus | null {
    switch (resolution) {
      case 'APPROVED':
        return ReimbursementStatus.APPROVED;
      case 'REJECTED':
        return ReimbursementStatus.REJECTED;
      default:
        return null;
    }
  }
}
