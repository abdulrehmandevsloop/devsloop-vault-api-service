import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AdvanceSalaryStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma';
import { WorkflowCompletedEvent } from 'src/workflows/events';

@Injectable()
export class AdvanceSalaryWorkflowHandler {
  private readonly logger = new Logger(AdvanceSalaryWorkflowHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('workflow.completed', { async: true })
  async handle(event: WorkflowCompletedEvent) {
    if (event.requestType !== 'ADVANCE_SALARY') return;

    this.logger.log(
      `Handling workflow.completed for advance salary ${event.requestId}: ${event.resolution}`,
    );

    try {
      const status = this.mapResolution(event.resolution);
      if (!status) return;

      await this.prisma.advanceSalaryRequest.update({
        where: { id: event.requestId },
        data: {
          status,
          ...(status === AdvanceSalaryStatus.DISBURSED ? { disbursedAt: new Date() } : {}),
        },
      });

      this.logger.log(`Advance salary ${event.requestId} status updated to ${status}`);
    } catch (err) {
      this.logger.error(
        `Failed to sync advance salary status for request ${event.requestId}: ${String(err)}`,
      );
    }
  }

  private mapResolution(resolution: string): AdvanceSalaryStatus | null {
    switch (resolution) {
      case 'APPROVED':
        return AdvanceSalaryStatus.DISBURSED;
      case 'REJECTED':
        return AdvanceSalaryStatus.REJECTED;
      default:
        return null;
    }
  }
}
