import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RepaymentAutoDeductService } from './repayment-auto-deduct.service';

@ApiTags('Scheduler')
@Controller('scheduler')
export class SchedulerController {
  constructor(private readonly autoDeduct: RepaymentAutoDeductService) {}

  @Post('trigger-repayment-auto-deduct')
  @Roles('SYSTEM', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually trigger past-due repayment auto-deduction',
    description:
      'Marks all loan, advance salary, and reimbursement installments whose ' +
      'scheduledMonth is before the current month as DEDUCTED/PROCESSED. ' +
      'This normally runs automatically at 00:05 on the 1st of each month.',
  })
  trigger() {
    return this.autoDeduct.autoDeductPastDue();
  }
}
