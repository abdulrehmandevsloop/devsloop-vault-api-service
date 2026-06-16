import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PayrollService } from '../payroll.service';

interface SalaryHoldChangedEvent {
  userId: string;
  fromMonth: string;
}

/**
 * When a salary hold is created, its period changed, or cancelled, the held-days
 * deduction for the affected months changes. This recomputes the employee's
 * still-editable payroll lines from the affected month onward so the "Salary on
 * hold" deduction reflects the change immediately (no manual recalculate needed).
 */
@Injectable()
export class SalaryHoldRecalcHandler {
  private readonly logger = new Logger(SalaryHoldRecalcHandler.name);

  constructor(private readonly payrollService: PayrollService) {}

  @OnEvent('salary-hold.changed', { async: true })
  async handle(event: SalaryHoldChangedEvent): Promise<void> {
    try {
      await this.payrollService.recalculateUserLinesFrom(event.userId, event.fromMonth);
    } catch (err) {
      this.logger.error(
        `Failed to recompute payroll lines after salary-hold change for user ${event.userId}: ${String(err)}`,
      );
    }
  }
}
