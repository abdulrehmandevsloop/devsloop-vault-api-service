import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiResponse } from '@nestjs/swagger';
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
import { WorkflowEngineService } from 'src/workflows/workflow-engine.service';

@ApiTags('Loans Review')
@ApiBearerAuth('JWT-auth')
@Controller('loans-review')
export class LoansReviewController {
  constructor(
    private readonly loansService: LoansService,
    private readonly workflowEngine: WorkflowEngineService,
  ) {}

  @Get()
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Get all loan requests for review (management)' })
  @ApiResponse({ status: 200, description: 'Paginated list of loan requests' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  findAll(@Query() query: ManagementLoansQueryDto, @CurrentUser('id') actorId: string) {
    return this.loansService.findAll(query, actorId);
  }

  @Get(':id')
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Get loan request details (management)' })
  @ApiParam({ name: 'id', description: 'Loan request ID' })
  @ApiResponse({ status: 200, description: 'Loan request details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Loan request not found' })
  findOne(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.loansService.findOne(id, userId, true);
  }

  @Get(':id/repayments')
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Get repayment schedule (management)' })
  @ApiParam({ name: 'id', description: 'Loan request ID' })
  @ApiResponse({ status: 200, description: 'Array of repayment installments' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Loan request not found' })
  getRepayments(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.loansService.getRepayments(id, userId, true);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a loan request via workflow engine' })
  @ApiParam({ name: 'id', description: 'Loan request ID' })
  @ApiResponse({ status: 201, description: 'Loan request approved' })
  @ApiResponse({ status: 400, description: 'Invalid status transition' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Loan request not found' })
  async approve(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: ApproveLoanDto,
    @CurrentUser('id') reviewerId: string,
  ) {
    if (await this.workflowEngine.isCurrentStepUserEntity('LOAN', id)) {
      if (!dto.reviewComment?.trim()) {
        throw new BadRequestException('A comment is required to approve at the HR stage');
      }
    }
    await this.loansService.saveApprovalMetadata(id, dto, reviewerId);
    const instance = await this.workflowEngine.findInstanceByRequest('LOAN', id);
    if (!instance)
      throw new NotFoundException('No active workflow instance found for this loan request');
    return this.workflowEngine.resolveStep(
      instance.id,
      instance.currentStepOrder,
      reviewerId,
      'APPROVED',
      dto.reviewComment,
    );
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a loan request via workflow engine' })
  @ApiParam({ name: 'id', description: 'Loan request ID' })
  @ApiResponse({ status: 201, description: 'Loan request rejected' })
  @ApiResponse({ status: 400, description: 'Invalid status transition' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Loan request not found' })
  async reject(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: RejectLoanDto,
    @CurrentUser('id') reviewerId: string,
  ) {
    await this.loansService.saveRejectionMetadata(id, dto, reviewerId);
    const instance = await this.workflowEngine.findInstanceByRequest('LOAN', id);
    if (!instance)
      throw new NotFoundException('No active workflow instance found for this loan request');
    return this.workflowEngine.resolveStep(
      instance.id,
      instance.currentStepOrder,
      reviewerId,
      'REJECTED',
      dto.reviewComment,
    );
  }

  @Post(':id/disburse')
  @ApiOperation({ summary: 'Approve disbursement step via workflow engine' })
  @ApiParam({ name: 'id', description: 'Loan request ID' })
  @ApiResponse({ status: 201, description: 'Loan disbursed and repayment schedule created' })
  @ApiResponse({ status: 400, description: 'Invalid status transition' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Loan request not found' })
  async disburse(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: DisburseLoanDto,
    @CurrentUser('id') disburserId: string,
  ) {
    if (await this.workflowEngine.isCurrentStepUserEntity('LOAN', id)) {
      if (!dto.disbursementNote?.trim()) {
        throw new BadRequestException('A comment is required to disburse at the HR stage');
      }
    }
    const loan = await this.loansService.disburse(id, dto, disburserId);
    const instance = await this.workflowEngine.findInstanceByRequest('LOAN', id);
    if (instance && ['PENDING', 'IN_PROGRESS', 'RETURNED'].includes(instance.status)) {
      await this.workflowEngine.resolveStep(
        instance.id,
        instance.currentStepOrder,
        disburserId,
        'APPROVED',
        dto.disbursementNote,
      );
    }
    return loan;
  }

  @Post(':id/process-repayment')
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Process a monthly repayment deduction for a loan' })
  @ApiParam({ name: 'id', description: 'Loan request ID' })
  @ApiResponse({ status: 201, description: 'Repayment installment processed' })
  @ApiResponse({ status: 400, description: 'Invalid installment number or already processed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Loan request not found' })
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
