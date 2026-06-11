import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PayrollService } from '../payroll.service';

interface LoanRecalibratedEvent {
  userId: string;
  fromMonth: string;
}

/**
 * When a loan (or advance-salary) balance is recalibrated — e.g. HR logs a manual
 * overpayment — the employee's future installments change. This recomputes that
 * employee's still-editable payroll lines from the affected month onward so the
 * loan deduction shown in payroll reflects the new installment immediately.
 */
@Injectable()
export class LoanRecalibrationHandler {
  private readonly logger = new Logger(LoanRecalibrationHandler.name);

  constructor(private readonly payrollService: PayrollService) {}

  @OnEvent('loan.repayment.recalibrated', { async: true })
  async handle(event: LoanRecalibratedEvent): Promise<void> {
    try {
      await this.payrollService.recalculateUserLinesFrom(event.userId, event.fromMonth);
    } catch (err) {
      this.logger.error(
        `Failed to recompute payroll lines after loan recalibration for user ${event.userId}: ${String(err)}`,
      );
    }
  }
}
