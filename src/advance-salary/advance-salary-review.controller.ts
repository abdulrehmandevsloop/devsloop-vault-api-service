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
import { AdvanceSalaryService } from 'src/advance-salary/advance-salary.service';
import {
  ApproveAdvanceSalaryDto,
  RejectAdvanceSalaryDto,
  DisburseAdvanceSalaryDto,
  ProcessAdvanceSalaryRepaymentDto,
  ManagementAdvanceSalaryQueryDto,
} from 'src/advance-salary/dto';
import { RequireEntity } from 'src/common/decorators';
import { CurrentUser } from 'src/common';
import { CuidValidationPipe } from 'src/common/pipes/cuid-validation.pipe';
import { WorkflowEngineService } from 'src/workflows/workflow-engine.service';

@ApiTags('Advance Salary Review')
@ApiBearerAuth('JWT-auth')
@Controller('advance-salary-review')
export class AdvanceSalaryReviewController {
  constructor(
    private readonly advanceSalaryService: AdvanceSalaryService,
    private readonly workflowEngine: WorkflowEngineService,
  ) {}

  @Get()
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Get all advance salary requests (management)' })
  @ApiResponse({ status: 200, description: 'Paginated list of advance salary requests' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  findAll(@Query() query: ManagementAdvanceSalaryQueryDto, @CurrentUser('id') actorId: string) {
    return this.advanceSalaryService.findAll(query, actorId);
  }

  @Get(':id')
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Get advance salary request details (management)' })
  @ApiParam({ name: 'id', description: 'Advance salary request ID' })
  @ApiResponse({ status: 200, description: 'Advance salary request details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  findOne(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.advanceSalaryService.findOne(id, userId, true);
  }

  @Get(':id/repayments')
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Get repayment schedule (management)' })
  @ApiParam({ name: 'id', description: 'Advance salary request ID' })
  @ApiResponse({ status: 200, description: 'Array of repayment installments' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  getRepayments(@Param('id', CuidValidationPipe) id: string, @CurrentUser('id') userId: string) {
    return this.advanceSalaryService.getRepayments(id, userId, true);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve an advance salary request via workflow engine' })
  @ApiParam({ name: 'id', description: 'Advance salary request ID' })
  @ApiResponse({ status: 201, description: 'Request approved' })
  @ApiResponse({ status: 400, description: 'Invalid status transition' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  async approve(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: ApproveAdvanceSalaryDto,
    @CurrentUser('id') reviewerId: string,
  ) {
    if (await this.workflowEngine.isCurrentStepUserEntity('ADVANCE_SALARY', id)) {
      if (!dto.reviewComment?.trim()) {
        throw new BadRequestException('A comment is required to approve at the HR stage');
      }
    }
    await this.advanceSalaryService.saveApprovalMetadata(id, dto, reviewerId);
    const instance = await this.workflowEngine.findInstanceByRequest('ADVANCE_SALARY', id);
    if (!instance)
      throw new NotFoundException(
        'No active workflow instance found for this advance salary request',
      );
    return this.workflowEngine.resolveStep(
      instance.id,
      instance.currentStepOrder,
      reviewerId,
      'APPROVED',
      dto.reviewComment,
    );
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject an advance salary request via workflow engine' })
  @ApiParam({ name: 'id', description: 'Advance salary request ID' })
  @ApiResponse({ status: 201, description: 'Request rejected' })
  @ApiResponse({ status: 400, description: 'Invalid status transition' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  async reject(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: RejectAdvanceSalaryDto,
    @CurrentUser('id') reviewerId: string,
  ) {
    await this.advanceSalaryService.saveRejectionMetadata(id, dto, reviewerId);
    const instance = await this.workflowEngine.findInstanceByRequest('ADVANCE_SALARY', id);
    if (!instance)
      throw new NotFoundException(
        'No active workflow instance found for this advance salary request',
      );
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
  @ApiParam({ name: 'id', description: 'Advance salary request ID' })
  @ApiResponse({ status: 201, description: 'Request marked as disbursed' })
  @ApiResponse({ status: 400, description: 'Invalid status transition' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  async disburse(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: DisburseAdvanceSalaryDto,
    @CurrentUser('id') disburserId: string,
  ) {
    if (await this.workflowEngine.isCurrentStepUserEntity('ADVANCE_SALARY', id)) {
      if (!dto.disbursementNote?.trim()) {
        throw new BadRequestException('A comment is required to disburse at the HR stage');
      }
    }
    const result = await this.advanceSalaryService.disburse(id, dto, disburserId);
    const instance = await this.workflowEngine.findInstanceByRequest('ADVANCE_SALARY', id);
    if (instance && ['PENDING', 'IN_PROGRESS', 'RETURNED'].includes(instance.status)) {
      await this.workflowEngine.resolveStep(
        instance.id,
        instance.currentStepOrder,
        disburserId,
        'APPROVED',
        dto.disbursementNote,
      );
    }
    return result;
  }

  @Post(':id/process-repayment')
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Process a monthly repayment deduction for advance salary' })
  @ApiParam({ name: 'id', description: 'Advance salary request ID' })
  @ApiResponse({ status: 201, description: 'Repayment installment processed' })
  @ApiResponse({ status: 400, description: 'Invalid installment number or already processed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  processRepayment(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: ProcessAdvanceSalaryRepaymentDto,
    @CurrentUser('id') processedById: string,
  ) {
    return this.advanceSalaryService.processRepayment(
      id,
      dto.installmentNo,
      processedById,
      dto.processingNote,
    );
  }
}
