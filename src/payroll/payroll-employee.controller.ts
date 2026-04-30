import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PayrollService } from './payroll.service';
import { CurrentUser } from 'src/common';

@ApiTags('Payroll - Employee')
@ApiBearerAuth('JWT-auth')
@Controller('payroll/my-payslips')
export class PayrollEmployeeController {
  constructor(private readonly payrollService: PayrollService) {}

  @Get()
  @ApiOperation({
    summary: 'List my payslips',
    description:
      'Returns all payroll periods that contain a payroll line for the currently authenticated user, ordered by month descending.',
  })
  @ApiResponse({ status: 200, description: 'Array of payslip summaries for the current user.' })
  @ApiResponse({ status: 401, description: 'Unauthorized — missing or invalid JWT.' })
  listMyPayslips(@CurrentUser('id') userId: string) {
    return this.payrollService.getMyPayslips(userId);
  }

  @Get(':yearMonth')
  @ApiOperation({
    summary: 'Get payslip breakdown for a specific month',
    description:
      'Returns the full payslip breakdown for the current user for the given month, including gross salary, deductions, salary adjustments, and net salary.',
  })
  @ApiParam({
    name: 'yearMonth',
    description: 'Month in YYYY-MM format',
    example: '2026-04',
  })
  @ApiResponse({ status: 200, description: 'Payslip breakdown for the requested month.' })
  @ApiResponse({ status: 401, description: 'Unauthorized — missing or invalid JWT.' })
  @ApiResponse({ status: 404, description: 'No payslip found for this user in the given month.' })
  getMyPayslip(@CurrentUser('id') userId: string, @Param('yearMonth') yearMonth: string) {
    return this.payrollService.getMyPayslip(userId, yearMonth);
  }
}
