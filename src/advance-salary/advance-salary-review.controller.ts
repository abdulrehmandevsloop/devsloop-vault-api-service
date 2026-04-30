import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
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

@ApiTags('Advance Salary Review')
@ApiBearerAuth('JWT-auth')
@Controller('advance-salary-review')
export class AdvanceSalaryReviewController {
  constructor(private readonly advanceSalaryService: AdvanceSalaryService) {}

  @Get()
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Get all advance salary requests (management)' })
  @ApiResponse({ status: 200, description: 'Paginated list of advance salary requests' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  findAll(@Query() query: ManagementAdvanceSalaryQueryDto) {
    return this.advanceSalaryService.findAll(query);
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
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Approve an advance salary request' })
  @ApiParam({ name: 'id', description: 'Advance salary request ID' })
  @ApiResponse({ status: 201, description: 'Request approved' })
  @ApiResponse({ status: 400, description: 'Invalid status transition' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  approve(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: ApproveAdvanceSalaryDto,
    @CurrentUser('id') reviewerId: string,
  ) {
    return this.advanceSalaryService.approve(id, dto, reviewerId);
  }

  @Post(':id/reject')
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Reject an advance salary request' })
  @ApiParam({ name: 'id', description: 'Advance salary request ID' })
  @ApiResponse({ status: 201, description: 'Request rejected' })
  @ApiResponse({ status: 400, description: 'Invalid status transition' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  reject(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: RejectAdvanceSalaryDto,
    @CurrentUser('id') reviewerId: string,
  ) {
    return this.advanceSalaryService.reject(id, dto, reviewerId);
  }

  @Post(':id/disburse')
  @RequireEntity('review-requests')
  @ApiOperation({ summary: 'Mark an advance salary request as disbursed' })
  @ApiParam({ name: 'id', description: 'Advance salary request ID' })
  @ApiResponse({ status: 201, description: 'Request marked as disbursed' })
  @ApiResponse({ status: 400, description: 'Invalid status transition' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  disburse(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: DisburseAdvanceSalaryDto,
    @CurrentUser('id') disburserId: string,
  ) {
    return this.advanceSalaryService.disburse(id, dto, disburserId);
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
