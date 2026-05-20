import {
  Controller,
  Get,
  NotFoundException,
  Post,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { ReimbursementsService } from 'src/reimbursements/reimbursements.service';
import { ReimbursementInstallmentsService } from 'src/reimbursements/reimbursement-installments.service';
import { WorkflowEngineService } from 'src/workflows/workflow-engine.service';
import {
  ApproveReimbursementDto,
  BulkProcessInstallmentsDto,
  CreateInstallmentPlanDto,
  PaginatedReimbursementsResponseDto,
  PendingReimbursementsQueryDto,
  ProcessInstallmentDto,
  RejectReimbursementDto,
  AdminOverrideReimbursementDto,
} from 'src/reimbursements/dto';
import { RequireEntity } from 'src/common/decorators';
import { CurrentUser } from 'src/common';

@ApiTags('Reimbursements Review')
@ApiBearerAuth('JWT-auth')
@Controller('reimbursements-review')
export class ReimbursementsReviewController {
  constructor(
    private readonly reimbursementsService: ReimbursementsService,
    private readonly installmentsService: ReimbursementInstallmentsService,
    private readonly workflowEngine: WorkflowEngineService,
  ) {}

  @Get('hr')
  @RequireEntity('review-requests')
  @ApiOperation({
    summary: 'Get pending reimbursement requests for HR review with pagination',
    description:
      'Retrieve paginated list of pending and HR review status reimbursement requests awaiting HR approval',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    example: 1,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: 20,
    description: 'Items per page (default: 20, max: 100)',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'PROCESSED'],
    description: 'Filter by specific status',
  })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    type: String,
    example: '2024-01-01',
    description: 'Filter by transaction date from (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    type: String,
    example: '2024-12-31',
    description: 'Filter by transaction date to (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    example: 'John Doe',
    description: 'Search by employee name, email, or request description',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of pending reimbursement requests',
    type: PaginatedReimbursementsResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden - HR access required' })
  findPending(
    @Query() query: PendingReimbursementsQueryDto,
  ): Promise<PaginatedReimbursementsResponseDto> {
    return this.reimbursementsService.findPendingForHR(query);
  }

  @Get(':id')
  @RequireEntity('review-requests')
  @ApiOperation({
    summary: 'Get reimbursement request details for review',
    description: 'Retrieve detailed information of a specific reimbursement request for HR review',
  })
  @ApiParam({ name: 'id', type: String, description: 'Reimbursement request ID' })
  @ApiResponse({ status: 200, description: 'Reimbursement request details' })
  @ApiResponse({ status: 404, description: 'Not found - Reimbursement request does not exist' })
  @ApiResponse({ status: 403, description: 'Forbidden - HR access required' })
  findOne(@Param('id') id: string) {
    return this.reimbursementsService.findOne(id);
  }

  @Post(':id/approve')
  @RequireEntity('review-requests')
  @ApiOperation({
    summary: 'Approve reimbursement request',
    description:
      'Approve a reimbursement request with processing details (salary adjustment or separate payment)',
  })
  @ApiParam({ name: 'id', type: String, description: 'Reimbursement request ID' })
  @ApiBody({ type: ApproveReimbursementDto })
  @ApiResponse({ status: 200, description: 'Reimbursement request approved successfully' })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Invalid processing type or missing required fields',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - HR access required' })
  async approve(
    @Param('id') id: string,
    @Body() approveReimbursementDto: ApproveReimbursementDto,
    @CurrentUser('id') reviewerId: string,
  ) {
    await this.reimbursementsService.saveApprovalMetadata(id, approveReimbursementDto, reviewerId);
    const instance = await this.workflowEngine.findInstanceByRequest('REIMBURSEMENT', id);
    if (!instance)
      throw new NotFoundException(
        'No active workflow instance found for this reimbursement request',
      );
    return this.workflowEngine.resolveStep(
      instance.id,
      instance.currentStepOrder,
      reviewerId,
      'APPROVED',
      approveReimbursementDto.hrComment,
    );
  }

  @Post(':id/reject')
  @RequireEntity('review-requests')
  @ApiOperation({
    summary: 'Reject reimbursement request via workflow engine',
    description: 'Reject a reimbursement request with reason (hrComment is required)',
  })
  @ApiParam({ name: 'id', type: String, description: 'Reimbursement request ID' })
  @ApiBody({ type: RejectReimbursementDto })
  @ApiResponse({ status: 200, description: 'Reimbursement request rejected successfully' })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Rejection reason (hrComment) is required',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - HR access required' })
  async reject(
    @Param('id') id: string,
    @Body() rejectReimbursementDto: RejectReimbursementDto,
    @CurrentUser('id') reviewerId: string,
  ) {
    const instance = await this.workflowEngine.findInstanceByRequest('REIMBURSEMENT', id);
    if (!instance)
      throw new NotFoundException(
        'No active workflow instance found for this reimbursement request',
      );
    return this.workflowEngine.resolveStep(
      instance.id,
      instance.currentStepOrder,
      reviewerId,
      'REJECTED',
      rejectReimbursementDto.hrComment,
    );
  }

  @Post(':id/admin-override')
  @RequireEntity('review-requests')
  @ApiOperation({
    summary: 'Administrative override for reimbursement',
    description:
      'HR Administrator can override approved amount or change status of any reimbursement request (PENDING, APPROVED, REJECTED, or PROCESSED). Requires mandatory reason for audit purposes.',
  })
  @ApiParam({ name: 'id', type: String, description: 'Reimbursement request ID' })
  @ApiBody({ type: AdminOverrideReimbursementDto })
  @ApiResponse({ status: 200, description: 'Administrative override applied successfully' })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Invalid amount, status transition, or missing override reason',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - HR/Admin access required' })
  adminOverride(
    @Param('id') id: string,
    @Body() overrideDto: AdminOverrideReimbursementDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.reimbursementsService.adminOverride(id, overrideDto, adminId);
  }

  // =========================================================================
  // Installment Plan Endpoints (HR)
  // =========================================================================

  @Get('installments/current-month')
  @RequireEntity('review-requests')
  @ApiOperation({
    summary: 'Get current-month pending installments',
    description:
      'Returns all installments scheduled for the current month with PENDING status — used for the bulk processing list',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by employee name or description',
  })
  @ApiResponse({ status: 200, description: 'Current-month installments list' })
  @ApiResponse({ status: 403, description: 'Forbidden - HR access required' })
  getCurrentMonthInstallments(@Query() query: { page?: number; limit?: number; search?: string }) {
    return this.installmentsService.getCurrentMonthInstallments(query);
  }

  @Post(':id/installment-plan')
  @RequireEntity('review-requests')
  @ApiOperation({
    summary: 'Create installment plan for an approved reimbursement',
    description:
      'Splits the approved amount across a defined number of months. Sum of all installment amounts must equal the approved amount.',
  })
  @ApiParam({ name: 'id', type: String, description: 'Reimbursement request ID' })
  @ApiBody({ type: CreateInstallmentPlanDto })
  @ApiResponse({ status: 201, description: 'Installment plan created successfully' })
  @ApiResponse({
    status: 400,
    description: 'Bad request - validation failed or plan already exists',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - HR access required' })
  createInstallmentPlan(
    @Param('id') id: string,
    @Body() dto: CreateInstallmentPlanDto,
    @CurrentUser('id') hrId: string,
  ) {
    return this.installmentsService.createPlan(id, dto, hrId);
  }

  @Get(':id/installments')
  @RequireEntity('review-requests')
  @ApiOperation({
    summary: 'Get installment plan for a reimbursement (HR view)',
    description: 'Returns all installments for a given reimbursement request',
  })
  @ApiParam({ name: 'id', type: String, description: 'Reimbursement request ID' })
  @ApiResponse({ status: 200, description: 'Installment schedule' })
  @ApiResponse({ status: 404, description: 'Not found' })
  getInstallments(@Param('id') id: string) {
    return this.installmentsService.getInstallments(id);
  }

  @Delete(':id/installment-plan')
  @RequireEntity('review-requests')
  @ApiOperation({
    summary: 'Delete installment plan',
    description:
      'Removes the installment plan for a reimbursement. Not allowed if any installment has already been processed.',
  })
  @ApiParam({ name: 'id', type: String, description: 'Reimbursement request ID' })
  @ApiResponse({ status: 200, description: 'Installment plan deleted' })
  @ApiResponse({ status: 400, description: 'Bad request - processed installments exist' })
  deleteInstallmentPlan(@Param('id') id: string, @CurrentUser('id') hrId: string) {
    return this.installmentsService.deletePlan(id, hrId);
  }

  @Post('installments/:installmentId/process')
  @RequireEntity('review-requests')
  @ApiOperation({
    summary: 'Process a single installment',
    description:
      'Marks an installment as processed. If all installments are processed, the parent reimbursement is automatically marked as PROCESSED.',
  })
  @ApiParam({ name: 'installmentId', type: String, description: 'Installment ID' })
  @ApiBody({ type: ProcessInstallmentDto })
  @ApiResponse({ status: 200, description: 'Installment processed successfully' })
  @ApiResponse({ status: 400, description: 'Already processed' })
  @ApiResponse({ status: 403, description: 'Forbidden - HR access required' })
  processInstallment(
    @Param('installmentId') installmentId: string,
    @Body() dto: ProcessInstallmentDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.installmentsService.processInstallment(installmentId, dto, userId);
  }

  @Post('installments/bulk-process')
  @RequireEntity('review-requests')
  @ApiOperation({
    summary: 'Bulk process installments',
    description: 'Mark multiple installments as processed in one request',
  })
  @ApiBody({ type: BulkProcessInstallmentsDto })
  @ApiResponse({ status: 200, description: 'Bulk process completed' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 403, description: 'Forbidden - HR access required' })
  bulkProcessInstallments(
    @Body() dto: BulkProcessInstallmentsDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.installmentsService.bulkProcessInstallments(dto, userId);
  }
}
