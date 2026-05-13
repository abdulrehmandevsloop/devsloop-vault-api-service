import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LoanStatus } from '@prisma/client';
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
      await this.prisma.loanRequest.updateMany({
        where: { id: event.requestId, status: LoanStatus.PENDING },
        data: { status: LoanStatus.APPROVED },
      });
    } catch (err) {
      this.logger.error(`Failed to set APPROVED for loan ${event.requestId}: ${String(err)}`);
    }
  }

  @OnEvent('workflow.completed', { async: true })
  async handle(event: WorkflowCompletedEvent) {
    if (event.requestType !== 'LOAN') return;

    this.logger.log(`Handling workflow.completed for loan ${event.requestId}: ${event.resolution}`);

    try {
      if (event.resolution === 'REJECTED') {
        // Rejection metadata (reviewedById, reviewComment) was already persisted by the
        // controller before resolving the step; here we only ensure the status is terminal.
        await this.prisma.loanRequest.updateMany({
          where: {
            id: event.requestId,
            status: { in: [LoanStatus.PENDING, LoanStatus.APPROVED] },
          },
          data: { status: LoanStatus.REJECTED },
        });
        this.logger.log(`Loan ${event.requestId} marked REJECTED`);
      } else if (event.resolution === 'CANCELLED') {
        // Handles external/admin-driven workflow cancellations (employee self-cancel
        // already sets the loan status directly in loans.service.ts:cancel()).
        await this.prisma.loanRequest.updateMany({
          where: {
            id: event.requestId,
            status: { in: [LoanStatus.PENDING, LoanStatus.APPROVED] },
          },
          data: { status: LoanStatus.CANCELLED },
        });
        this.logger.log(`Loan ${event.requestId} marked CANCELLED`);
      }
      // APPROVED resolution means the disbursement step completed. The disburse endpoint
      // already set the status to DISBURSED and created the repayment schedule, so no
      // action is needed here.
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
      await this.prisma.loanRequest.updateMany({
        where: { id: event.requestId, status: LoanStatus.APPROVED },
        data: { status: LoanStatus.PENDING },
      });
    } catch (err) {
      this.logger.error(
        `Failed to reset loan status on return for ${event.requestId}: ${String(err)}`,
      );
    }
  }
}
