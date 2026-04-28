import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WorkflowCompletedEvent } from 'src/workflows/events';
import { LeavesService } from '../leaves.service';

@Injectable()
export class LeaveWorkflowHandler {
  private readonly logger = new Logger(LeaveWorkflowHandler.name);

  constructor(private readonly leavesService: LeavesService) {}

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
