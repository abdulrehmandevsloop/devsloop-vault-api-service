import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from 'src/prisma';
import { WorkflowCompletedEvent, WorkflowStepCompletedEvent } from 'src/workflows/events';
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

    // After step 1 is approved, mark leave as TEAM_LEAD_APPROVED so HR
    // can see it in their review queue under "Forwarded to HR" tab.
    // The workflow.completed handler will override this to APPROVED when all steps are done.
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

  @OnEvent('workflow.completed', { async: true })
  async handle(event: WorkflowCompletedEvent) {
    if (event.requestType !== 'LEAVE') return;

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
