import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LoanStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma';
import { WorkflowCompletedEvent } from 'src/workflows/events';

@Injectable()
export class LoanWorkflowHandler {
  private readonly logger = new Logger(LoanWorkflowHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('workflow.completed', { async: true })
  async handle(event: WorkflowCompletedEvent) {
    if (event.requestType !== 'LOAN') return;

    this.logger.log(`Handling workflow.completed for loan ${event.requestId}: ${event.resolution}`);

    try {
      const status = this.mapResolution(event.resolution);
      if (!status) return;

      await this.prisma.loanRequest.update({
        where: { id: event.requestId },
        data: {
          status,
          ...(status === LoanStatus.REJECTED ? { reviewedAt: new Date() } : {}),
          ...(status === LoanStatus.DISBURSED ? { disbursedAt: new Date() } : {}),
        },
      });

      this.logger.log(`Loan ${event.requestId} status updated to ${status}`);
    } catch (err) {
      this.logger.error(
        `Failed to sync loan status for request ${event.requestId}: ${String(err)}`,
      );
    }
  }

  private mapResolution(resolution: string): LoanStatus | null {
    switch (resolution) {
      case 'APPROVED':
        return LoanStatus.DISBURSED;
      case 'REJECTED':
        return LoanStatus.REJECTED;
      case 'CANCELLED':
        return LoanStatus.CANCELLED;
      default:
        return null;
    }
  }
}
