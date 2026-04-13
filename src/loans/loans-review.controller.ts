import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { LoansService } from 'src/loans/loans.service';
import {
  ApproveLoanDto,
  RejectLoanDto,
  DisburseLoanDto,
  ProcessRepaymentDto,
  ManagementLoansQueryDto,
} from 'src/loans/dto';
import { RequireEntity } from 'src/common/decorators';
import { CurrentUser } from 'src/common';
import { CuidValidationPipe } from 'src/common/pipes/cuid-validation.pipe';

@ApiTags('Loans Review')
@ApiBearerAuth('JWT-auth')
@Controller('loans-review')
export class LoansReviewController {
  constructor(private readonly loansService: LoansService) {}

  @Get()
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Get all loan requests for review (management)' })
  findAll(@Query() query: ManagementLoansQueryDto) {
    return this.loansService.findAll(query);
  }

  @Get(':id')
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Get loan request details (management)' })
  @ApiParam({ name: 'id', description: 'Loan request ID' })
  findOne(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.loansService.findOne(id, userId, true);
  }

  @Get(':id/repayments')
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Get repayment schedule (management)' })
  @ApiParam({ name: 'id', description: 'Loan request ID' })
  getRepayments(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.loansService.getRepayments(id, userId, true);
  }

  @Post(':id/approve')
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Approve a loan request' })
  @ApiParam({ name: 'id', description: 'Loan request ID' })
  approve(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: ApproveLoanDto,
    @CurrentUser('id') reviewerId: string,
  ) {
    return this.loansService.approve(id, dto, reviewerId);
  }

  @Post(':id/reject')
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Reject a loan request' })
  @ApiParam({ name: 'id', description: 'Loan request ID' })
  reject(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: RejectLoanDto,
    @CurrentUser('id') reviewerId: string,
  ) {
    return this.loansService.reject(id, dto, reviewerId);
  }

  @Post(':id/disburse')
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Mark a loan as disbursed and generate repayment schedule' })
  @ApiParam({ name: 'id', description: 'Loan request ID' })
  disburse(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: DisburseLoanDto,
    @CurrentUser('id') disburserId: string,
  ) {
    return this.loansService.disburse(id, dto, disburserId);
  }

  @Post(':id/process-repayment')
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Process a monthly repayment deduction for a loan' })
  @ApiParam({ name: 'id', description: 'Loan request ID' })
  processRepayment(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: ProcessRepaymentDto,
    @CurrentUser('id') processedById: string,
  ) {
    return this.loansService.processRepayment(
      id,
      dto.installmentNo,
      processedById,
      dto.processingNote,
    );
  }
}
