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
export class AdvanceSalaryWorkflowHandler {
  private readonly logger = new Logger(AdvanceSalaryWorkflowHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('workflow.step.completed', { async: true })
  async handleStepCompleted(event: WorkflowStepCompletedEvent) {
    if (event.requestType !== 'ADVANCE_SALARY') return;
    if (event.resolution !== 'APPROVED') return;
    try {
      await this.prisma.dynamicRequest.updateMany({
        where: { id: event.requestId, status: DynamicRequestStatus.PENDING },
        data: { status: DynamicRequestStatus.IN_PROGRESS },
      });
    } catch (err) {
      this.logger.error(
        `Failed to set IN_PROGRESS for advance salary ${event.requestId}: ${String(err)}`,
      );
    }
  }

  @OnEvent('workflow.completed', { async: true })
  async handle(event: WorkflowCompletedEvent) {
    if (event.requestType !== 'ADVANCE_SALARY') return;

    this.logger.log(
      `Handling workflow.completed for advance salary ${event.requestId}: ${event.resolution}`,
    );

    const ACTIVE_STATUSES = [DynamicRequestStatus.PENDING, DynamicRequestStatus.IN_PROGRESS];

    try {
      if (event.resolution === 'APPROVED') {
        await this.prisma.dynamicRequest.updateMany({
          where: { id: event.requestId, status: { in: ACTIVE_STATUSES } },
          data: { status: DynamicRequestStatus.APPROVED },
        });
        this.logger.log(`Advance salary ${event.requestId} marked APPROVED`);
      } else if (event.resolution === 'REJECTED') {
        await this.prisma.dynamicRequest.updateMany({
          where: { id: event.requestId, status: { in: ACTIVE_STATUSES } },
          data: { status: DynamicRequestStatus.REJECTED },
        });
        this.logger.log(`Advance salary ${event.requestId} marked REJECTED`);
      } else if (event.resolution === 'CANCELLED') {
        await this.prisma.dynamicRequest.updateMany({
          where: { id: event.requestId, status: { in: ACTIVE_STATUSES } },
          data: { status: DynamicRequestStatus.CANCELLED },
        });
        this.logger.log(`Advance salary ${event.requestId} marked CANCELLED`);
      }
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
      await this.prisma.dynamicRequest.updateMany({
        where: { id: event.requestId, status: DynamicRequestStatus.IN_PROGRESS },
        data: { status: DynamicRequestStatus.PENDING },
      });
    } catch (err) {
      this.logger.error(
        `Failed to reset advance salary status on return for ${event.requestId}: ${String(err)}`,
      );
    }
  }
}
