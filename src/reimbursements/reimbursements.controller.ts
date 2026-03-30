import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
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
import {
  CreateReimbursementDto,
  ManagementReimbursementsQueryDto,
  PaginatedReimbursementsResponseDto,
  ProcessReimbursementDto,
  ReimbursementsQueryDto,
  UpdateReimbursementDto,
} from 'src/reimbursements/dto';
import { RequireEntity } from 'src/common/decorators';
import { CurrentUser } from 'src/common';
import { ReimbursementStatus } from '@prisma/client';

@ApiTags('Reimbursements')
@ApiBearerAuth('JWT-auth')
@Controller('reimbursements')
export class ReimbursementsController {
  constructor(
    private readonly reimbursementsService: ReimbursementsService,
    private readonly installmentsService: ReimbursementInstallmentsService,
  ) {}

  @Post()
  @RequireEntity('reimbursement')
  @ApiOperation({
    summary: 'Create a new reimbursement request',
    description:
      'Submit a new reimbursement request with receipt and details. Receipt upload is required.',
  })
  @ApiBody({ type: CreateReimbursementDto })
  @ApiResponse({
    status: 201,
    description: 'Reimbursement request created successfully',
    schema: {
      example: {
        id: 'clxxx',
        employeeId: 'EMP001',
        reimbursementType: 'MEDICAL',
        amount: 5000,
        status: 'PENDING',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Invalid data or missing required fields',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(
    @Body() createReimbursementDto: CreateReimbursementDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.reimbursementsService.create(createReimbursementDto, userId);
  }

  @Get()
  @RequireEntity('reimbursement')
  @ApiOperation({
    summary: 'Get user reimbursement requests with pagination',
    description: 'Retrieve paginated list of reimbursement requests for the authenticated user',
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
    description: 'Filter by status',
  })
  @ApiQuery({
    name: 'reimbursementType',
    required: false,
    enum: ['MEDICAL', 'FOOD', 'FUEL_TRAVELLING', 'IT_GADGETS', 'OTHER'],
    description: 'Filter by type',
  })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    type: String,
    example: '2024-01-01',
    description: 'Filter from date (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    type: String,
    example: '2024-12-31',
    description: 'Filter to date (YYYY-MM-DD)',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of reimbursement requests',
    type: PaginatedReimbursementsResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(
    @CurrentUser('id') userId: string,
    @Query() query: ReimbursementsQueryDto,
  ): Promise<PaginatedReimbursementsResponseDto> {
    return this.reimbursementsService.findAll(userId, query);
  }

  @Get('management')
  @RequireEntity('manage_reimbursement')
  @ApiOperation({
    summary: 'Get all reimbursement requests for management (HR/Admin)',
    description:
      'Retrieve paginated list of all reimbursement requests for HR review and admin processing',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'PROCESSED'],
  })
  @ApiQuery({
    name: 'reimbursementType',
    required: false,
    enum: ['MEDICAL', 'FOOD', 'FUEL_TRAVELLING', 'IT_GADGETS', 'OTHER'],
  })
  @ApiQuery({
    name: 'employeeId',
    required: false,
    type: String,
    description: 'Filter by employee ID',
  })
  @ApiQuery({
    name: 'department',
    required: false,
    type: String,
    description: 'Filter by department',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by employee name or email',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of all reimbursement requests',
    type: PaginatedReimbursementsResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  findAllForManagement(
    @Query() query: ManagementReimbursementsQueryDto,
  ): Promise<PaginatedReimbursementsResponseDto> {
    return this.reimbursementsService.findAllForManagement(query);
  }

  @Get(':id')
  @RequireEntity('reimbursement')
  @ApiOperation({
    summary: 'Get reimbursement request by ID',
    description: 'Retrieve details of a specific reimbursement request',
  })
  @ApiParam({ name: 'id', type: String, description: 'Reimbursement request ID' })
  @ApiResponse({ status: 200, description: 'Reimbursement request details' })
  @ApiResponse({ status: 404, description: 'Not found - Reimbursement request does not exist' })
  @ApiResponse({ status: 403, description: 'Forbidden - Access denied' })
  findOne(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.reimbursementsService.findOne(id, userId);
  }

  @Patch(':id')
  @RequireEntity('reimbursement')
  @ApiOperation({
    summary: 'Update reimbursement request',
    description: 'Update an existing reimbursement request (only allowed for PENDING requests)',
  })
  @ApiParam({ name: 'id', type: String, description: 'Reimbursement request ID' })
  @ApiBody({ type: UpdateReimbursementDto })
  @ApiResponse({ status: 200, description: 'Reimbursement request updated successfully' })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Cannot update approved/rejected requests',
  })
  @ApiResponse({ status: 404, description: 'Not found' })
  update(
    @Param('id') id: string,
    @Body() updateReimbursementDto: UpdateReimbursementDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.reimbursementsService.update(id, updateReimbursementDto, userId);
  }

  @Delete(':id')
  @RequireEntity('reimbursement')
  @ApiOperation({
    summary: 'Cancel reimbursement request',
    description: 'Cancel/delete a reimbursement request (only PENDING requests can be cancelled)',
  })
  @ApiParam({ name: 'id', type: String, description: 'Reimbursement request ID' })
  @ApiResponse({ status: 200, description: 'Reimbursement request cancelled successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - Cannot cancel processed requests' })
  @ApiResponse({ status: 404, description: 'Not found' })
  remove(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.reimbursementsService.remove(id, userId);
  }

  @Post(':id/process')
  @RequireEntity('manage_reimbursement')
  @ApiOperation({
    summary: 'Process approved reimbursement request (Admin)',
    description: 'Mark an approved reimbursement as processed with payment details',
  })
  @ApiParam({ name: 'id', type: String, description: 'Reimbursement request ID' })
  @ApiBody({ type: ProcessReimbursementDto })
  @ApiResponse({ status: 200, description: 'Reimbursement request processed successfully' })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Only APPROVED requests can be processed',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin access required' })
  process(
    @Param('id') id: string,
    @Body() processReimbursementDto: ProcessReimbursementDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.reimbursementsService.process(id, processReimbursementDto, userId);
  }

  @Post('bulk-update-status')
  @RequireEntity('manage_reimbursement')
  @ApiOperation({
    summary: 'Bulk update reimbursement status',
    description: 'Update status of multiple reimbursement requests at once',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' } },
        status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'PROCESSED'] },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Bulk update completed successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - HR/Admin access required' })
  bulkUpdateStatus(
    @Body() body: { ids: string[]; status: ReimbursementStatus },
    @CurrentUser('id') userId: string,
  ) {
    return this.reimbursementsService.bulkUpdateStatus(body.ids, body.status, userId);
  }

  @Get(':id/installments')
  @RequireEntity('reimbursement')
  @ApiOperation({
    summary: 'Get payment schedule for a reimbursement',
    description: 'Returns the installment plan for an approved reimbursement (employee view)',
  })
  @ApiParam({ name: 'id', type: String, description: 'Reimbursement request ID' })
  @ApiResponse({ status: 200, description: 'Installment schedule' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  getInstallments(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.installmentsService.getInstallments(id, userId);
  }
}
