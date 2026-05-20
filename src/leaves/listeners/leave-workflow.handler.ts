// =============================================================================
// LEGACY — kept only for reference.
//
// Mirrors dynamic-workflow events back to the legacy `leave_requests` table
// (for the historical rows that were also migrated into `dynamic_requests`).
// New dynamic-only leaves don't exist in `leave_requests`, so the updateMany
// calls here are no-ops for them. Safe to delete once you no longer need the
// legacy table to reflect workflow state.
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from 'src/prisma';
import {
  WorkflowCompletedEvent,
  WorkflowReturnedEvent,
  WorkflowStepCompletedEvent,
} from 'src/workflows/events';
import { LeavesService } from '../leaves.service';

@Injectable()
export class LeaveWorkflowHandler {
  private readonly logger = new Logger(LeaveWorkflowHandler.name);

  constructor(
    private readonly leavesService: LeavesService,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent('workflow.step.completed', { async: true })
  async handleStepCompleted(event: WorkflowStepCompletedEvent) {
    if (event.requestType !== 'LEAVE') return;
    if (event.resolution !== 'APPROVED') return;

    const legacy = await this.prisma.leaveRequest.findUnique({
      where: { id: event.requestId },
      select: { id: true },
    });
    if (!legacy) return;

    try {
      await this.prisma.leaveRequest.updateMany({
        where: { id: event.requestId, status: 'PENDING' },
        data: { status: 'TEAM_LEAD_APPROVED' },
      });
    } catch (err) {
      this.logger.error(
        `Failed to set TEAM_LEAD_APPROVED for leave ${event.requestId}: ${String(err)}`,
      );
    }
  }

  @OnEvent('workflow.returned', { async: true })
  async handleReturned(event: WorkflowReturnedEvent) {
    if (event.requestType !== 'LEAVE') return;

    const legacy = await this.prisma.leaveRequest.findUnique({
      where: { id: event.requestId },
      select: { id: true },
    });
    if (!legacy) return;

    try {
      await this.prisma.leaveRequest.updateMany({
        where: { id: event.requestId, status: 'TEAM_LEAD_APPROVED' },
        data: { status: 'PENDING' },
      });
    } catch (err) {
      this.logger.error(
        `Failed to reset leave status on return for ${event.requestId}: ${String(err)}`,
      );
    }
  }

  @OnEvent('workflow.completed', { async: true })
  async handle(event: WorkflowCompletedEvent) {
    if (event.requestType !== 'LEAVE') return;

    const legacy = await this.prisma.leaveRequest.findUnique({
      where: { id: event.requestId },
      select: { id: true },
    });
    if (!legacy) return;

    this.logger.log(
      `Handling workflow.completed for leave ${event.requestId}: ${event.resolution}`,
    );

    try {
      switch (event.resolution) {
        case 'APPROVED':
          await this.leavesService.handleWorkflowApproval(event.requestId, null);
          break;
        case 'REJECTED':
          await this.leavesService.handleWorkflowRejection(event.requestId);
          break;
        case 'CANCELLED':
          await this.leavesService.handleWorkflowCancellation(event.requestId);
          break;
      }
    } catch (err) {
      this.logger.error(
        `Failed to sync leave status for request ${event.requestId}: ${String(err)}`,
      );
    }
  }
}
