import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PayrollService } from './payroll.service';
import { CurrentUser } from 'src/common';

@ApiTags('Payroll - Employee')
@ApiBearerAuth('JWT-auth')
@Controller('payroll/my-payslips')
export class PayrollEmployeeController {
  constructor(private readonly payrollService: PayrollService) {}

  @Get()
  @ApiOperation({ summary: 'List payroll periods that have a line for the current user' })
  listMyPayslips(@CurrentUser('id') userId: string) {
    return this.payrollService.getMyPayslips(userId);
  }

  @Get(':yearMonth')
  @ApiOperation({ summary: 'Get payslip breakdown for a specific month' })
  getMyPayslip(@CurrentUser('id') userId: string, @Param('yearMonth') yearMonth: string) {
    return this.payrollService.getMyPayslip(userId, yearMonth);
  }
}
