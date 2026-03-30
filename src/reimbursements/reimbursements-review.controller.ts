import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
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
import {
  ApproveReimbursementDto,
  PaginatedReimbursementsResponseDto,
  PendingReimbursementsQueryDto,
  RejectReimbursementDto,
  AdminOverrideReimbursementDto,
} from 'src/reimbursements/dto';
import { RequireEntity } from 'src/common/decorators';
import { CurrentUser } from 'src/common';

@ApiTags('Reimbursements Review')
@ApiBearerAuth('JWT-auth')
@Controller('reimbursements-review')
export class ReimbursementsReviewController {
  constructor(private readonly reimbursementsService: ReimbursementsService) {}

  @Get('hr')
  @RequireEntity('manage_reimbursement')
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
  @RequireEntity('manage_reimbursement')
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
  @RequireEntity('manage_reimbursement')
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
  approve(
    @Param('id') id: string,
    @Body() approveReimbursementDto: ApproveReimbursementDto,
    @CurrentUser('id') reviewerId: string,
  ) {
    return this.reimbursementsService.approve(id, approveReimbursementDto, reviewerId);
  }

  @Post(':id/reject')
  @RequireEntity('manage_reimbursement')
  @ApiOperation({
    summary: 'Reject reimbursement request',
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
  reject(
    @Param('id') id: string,
    @Body() rejectReimbursementDto: RejectReimbursementDto,
    @CurrentUser('id') reviewerId: string,
  ) {
    return this.reimbursementsService.reject(id, rejectReimbursementDto, reviewerId);
  }

  @Post(':id/admin-override')
  @RequireEntity('manage_reimbursement')
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
}
