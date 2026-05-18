import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DynamicRequestStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma';
import {
  WorkflowCompletedEvent,
  WorkflowReturnedEvent,
  WorkflowStepCompletedEvent,
} from 'src/workflows/events';

@Injectable()
export class LoanWorkflowHandler {
  private readonly logger = new Logger(LoanWorkflowHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('workflow.step.completed', { async: true })
  async handleStepCompleted(event: WorkflowStepCompletedEvent) {
    if (event.requestType !== 'LOAN') return;
    if (event.resolution !== 'APPROVED') return;
    try {
      await this.prisma.dynamicRequest.updateMany({
        where: { id: event.requestId, status: DynamicRequestStatus.PENDING },
        data: { status: DynamicRequestStatus.IN_PROGRESS },
      });
    } catch (err) {
      this.logger.error(`Failed to set IN_PROGRESS for loan ${event.requestId}: ${String(err)}`);
    }
  }

  @OnEvent('workflow.completed', { async: true })
  async handle(event: WorkflowCompletedEvent) {
    if (event.requestType !== 'LOAN') return;

    this.logger.log(`Handling workflow.completed for loan ${event.requestId}: ${event.resolution}`);

    // Statuses that the workflow-completion handler is allowed to mutate.
    // DISBURSED/REPAYING/COMPLETED are sticky: once funds are released, a later
    // workflow step approving the request must not overwrite the loan back to
    // APPROVED — that would lose the ledger and disbursed-tab placement.
    const ACTIVE_STATUSES = [DynamicRequestStatus.PENDING, DynamicRequestStatus.IN_PROGRESS];

    try {
      if (event.resolution === 'APPROVED') {
        await this.prisma.dynamicRequest.updateMany({
          where: { id: event.requestId, status: { in: ACTIVE_STATUSES } },
          data: { status: DynamicRequestStatus.APPROVED },
        });
        this.logger.log(`Loan ${event.requestId} marked APPROVED`);
      } else if (event.resolution === 'REJECTED') {
        await this.prisma.dynamicRequest.updateMany({
          where: { id: event.requestId, status: { in: ACTIVE_STATUSES } },
          data: { status: DynamicRequestStatus.REJECTED },
        });
        this.logger.log(`Loan ${event.requestId} marked REJECTED`);
      } else if (event.resolution === 'CANCELLED') {
        await this.prisma.dynamicRequest.updateMany({
          where: { id: event.requestId, status: { in: ACTIVE_STATUSES } },
          data: { status: DynamicRequestStatus.CANCELLED },
        });
        this.logger.log(`Loan ${event.requestId} marked CANCELLED`);
      }
    } catch (err) {
      this.logger.error(
        `Failed to sync loan status for request ${event.requestId}: ${String(err)}`,
      );
    }
  }

  @OnEvent('workflow.returned', { async: true })
  async handleReturned(event: WorkflowReturnedEvent) {
    if (event.requestType !== 'LOAN') return;
    try {
      await this.prisma.dynamicRequest.updateMany({
        where: { id: event.requestId, status: DynamicRequestStatus.IN_PROGRESS },
        data: { status: DynamicRequestStatus.PENDING },
      });
    } catch (err) {
      this.logger.error(
        `Failed to reset loan status on return for ${event.requestId}: ${String(err)}`,
      );
    }
  }
}
