import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PgBossService } from 'src/queue/pg-boss.service';

const AUTO_APPROVE_QUEUE = 'workflow-auto-approve';

@Injectable()
export class WorkflowSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowSchedulerService.name);

  constructor(private readonly pgBossService: PgBossService) {}

  async onModuleInit() {
    const boss = this.pgBossService.getBoss();
    await boss.work(AUTO_APPROVE_QUEUE, async (job) => {
      const { stepInstanceId } = job.data as { stepInstanceId: string };
      await this.handleAutoApprove(stepInstanceId);
    });
    this.logger.log(`Worker registered for queue: ${AUTO_APPROVE_QUEUE}`);
  }

  async scheduleAutoApprove(stepInstanceId: string, afterHours: number): Promise<void> {
    const boss = this.pgBossService.getBoss();
    const delayMs = afterHours * 3600 * 1000;
    const startAfter = new Date(Date.now() + delayMs);

    await boss.send(
      AUTO_APPROVE_QUEUE,
      { stepInstanceId },
      { startAfter: startAfter.toISOString() },
    );

    this.logger.log(`Scheduled auto-approve for step instance ${stepInstanceId} in ${afterHours}h`);
  }

  private async handleAutoApprove(stepInstanceId: string): Promise<void> {
    this.logger.log(`Auto-approve triggered for step instance ${stepInstanceId}`);
    if (this._autoApproveCallback) {
      await this._autoApproveCallback(stepInstanceId);
    } else {
      this.logger.warn(`No auto-approve callback registered; skipping ${stepInstanceId}`);
    }
  }

  private _autoApproveCallback: ((stepInstanceId: string) => Promise<void>) | null = null;

  registerAutoApproveCallback(cb: (stepInstanceId: string) => Promise<void>): void {
    this._autoApproveCallback = cb;
  }
}
