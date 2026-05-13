import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AdvanceSalaryStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma';
import {
  WorkflowCompletedEvent,
  WorkflowReturnedEvent,
  WorkflowStepCompletedEvent,
} from 'src/workflows/events';

@Injectable()
export class AdvanceSalaryWorkflowHandler {
  private readonly logger = new Logger(AdvanceSalaryWorkflowHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('workflow.step.completed', { async: true })
  async handleStepCompleted(event: WorkflowStepCompletedEvent) {
    if (event.requestType !== 'ADVANCE_SALARY') return;
    if (event.resolution !== 'APPROVED') return;
    try {
      await this.prisma.advanceSalaryRequest.updateMany({
        where: { id: event.requestId, status: AdvanceSalaryStatus.PENDING },
        data: { status: AdvanceSalaryStatus.APPROVED },
      });
    } catch (err) {
      this.logger.error(
        `Failed to set APPROVED for advance salary ${event.requestId}: ${String(err)}`,
      );
    }
  }

  @OnEvent('workflow.completed', { async: true })
  async handle(event: WorkflowCompletedEvent) {
    if (event.requestType !== 'ADVANCE_SALARY') return;

    this.logger.log(
      `Handling workflow.completed for advance salary ${event.requestId}: ${event.resolution}`,
    );

    try {
      if (event.resolution === 'REJECTED') {
        // Rejection metadata (reviewedById, reviewComment) was already persisted by the
        // controller before resolving the step; here we only ensure the status is terminal.
        await this.prisma.advanceSalaryRequest.updateMany({
          where: {
            id: event.requestId,
            status: { in: [AdvanceSalaryStatus.PENDING, AdvanceSalaryStatus.APPROVED] },
          },
          data: { status: AdvanceSalaryStatus.REJECTED },
        });
        this.logger.log(`Advance salary ${event.requestId} marked REJECTED`);
      } else if (event.resolution === 'CANCELLED') {
        // Handles external/admin-driven workflow cancellations (employee self-cancel
        // already sets the request status directly in advance-salary.service.ts:cancel()).
        await this.prisma.advanceSalaryRequest.updateMany({
          where: {
            id: event.requestId,
            status: { in: [AdvanceSalaryStatus.PENDING, AdvanceSalaryStatus.APPROVED] },
          },
          data: { status: AdvanceSalaryStatus.CANCELLED },
        });
        this.logger.log(`Advance salary ${event.requestId} marked CANCELLED`);
      }
      // APPROVED resolution means the disbursement step completed. The disburse endpoint
      // already set the status to DISBURSED and created the repayment schedule, so no
      // action is needed here.
    } catch (err) {
      this.logger.error(
        `Failed to sync advance salary status for request ${event.requestId}: ${String(err)}`,
      );
    }
  }

  @OnEvent('workflow.returned', { async: true })
  async handleReturned(event: WorkflowReturnedEvent) {
    if (event.requestType !== 'ADVANCE_SALARY') return;
    try {
      await this.prisma.advanceSalaryRequest.updateMany({
        where: { id: event.requestId, status: AdvanceSalaryStatus.APPROVED },
        data: { status: AdvanceSalaryStatus.PENDING },
      });
    } catch (err) {
      this.logger.error(
        `Failed to reset advance salary status on return for ${event.requestId}: ${String(err)}`,
      );
    }
  }
}
