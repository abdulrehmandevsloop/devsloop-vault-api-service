import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Patch,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { LeavesService } from './leaves.service';
import { LeaveBalanceBulkImportService } from './services/leave-balance-bulk-import.service';
import { CurrentUser, CuidValidationPipe, RequireEntity } from '../common';
import {
  AllowedLeaveTypesResponseDto,
  HrApplySpecialLeaveDto,
  HrLeavesQueryDto,
  HrModifyLeaveRequestDto,
  HrReviewLeaveRequestDto,
  HrSplitLeaveRequestDto,
  HrStatsResponseDto,
  LeaveBalanceResponseDto,
  LeaveBalanceBulkImportResultDto,
  LeaveRequestResponseDto,
  PaginatedLeavesResponseDto,
  UpdateLeaveTypeAccessDto,
} from './dto';

@ApiTags('Leaves – HR Management')
@ApiBearerAuth('JWT-auth')
@RequireEntity('user')
@Controller('leaves/management')
export class LeavesManagementController {
  constructor(
    private readonly leavesService: LeavesService,
    private readonly leaveBalanceBulkImportService: LeaveBalanceBulkImportService,
  ) {}

  @Get('stats')
  @ApiOperation({
    summary: 'Get leave statistics summary',
    description:
      'Returns aggregate leave stats for a given year, optionally filtered by department.',
  })
  @ApiQuery({
    name: 'year',
    required: false,
    type: Number,
    description: 'Calendar year (default: current year)',
  })
  @ApiQuery({
    name: 'department',
    required: false,
    type: String,
    description: 'Filter by department name',
  })
  @ApiResponse({ status: 200, type: HrStatsResponseDto })
  getStats(
    @Query('year') year: string | undefined,
    @Query('department') department: string | undefined,
  ): Promise<HrStatsResponseDto> {
    return this.leavesService.getHrStats(year ? parseInt(year, 10) : undefined, department);
  }

  @Get('absent')
  @ApiOperation({
    summary: 'Get employees absent on a given date',
    description:
      'Returns approved leave requests overlapping the specified date (defaults to today). Includes WFH.',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    type: String,
    description: 'YYYY-MM-DD, defaults to today',
  })
  @ApiQuery({ name: 'department', required: false, type: String })
  @ApiResponse({ status: 200, type: [LeaveRequestResponseDto] })
  getAbsentEmployees(
    @Query('date') date: string | undefined,
    @Query('department') department: string | undefined,
  ): Promise<LeaveRequestResponseDto[]> {
    return this.leavesService.getAbsentEmployees(date, department) as unknown as Promise<
      LeaveRequestResponseDto[]
    >;
  }

  @Get('employees/:userId/balance')
  @ApiOperation({
    summary: "View any employee's leave balance",
    description: "Returns the specified employee's leave balance for the given year.",
  })
  @ApiParam({ name: 'userId', description: 'Employee user ID (CUID)' })
  @ApiQuery({
    name: 'year',
    required: false,
    type: Number,
    description: 'Calendar year (default: current year)',
  })
  @ApiResponse({ status: 200, type: LeaveBalanceResponseDto })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  getEmployeeBalance(
    @Param('userId', CuidValidationPipe) userId: string,
    @Query('year') year: string | undefined,
  ): Promise<LeaveBalanceResponseDto> {
    return this.leavesService.getEmployeeBalance(userId, year ? parseInt(year, 10) : undefined);
  }

  @Get()
  @ApiOperation({
    summary: 'List all leave requests',
    description:
      'Returns a paginated list of all leave requests across the organisation with full filter support.',
  })
  @ApiResponse({ status: 200, type: PaginatedLeavesResponseDto })
  findLeaves(@Query() query: HrLeavesQueryDto): Promise<PaginatedLeavesResponseDto> {
    return this.leavesService.findHrLeaves(query);
  }

  @Get('bulk-import-balances/template')
  @ApiOperation({ summary: 'Download CSV template for leave balance bulk import' })
  @ApiResponse({ status: 200, description: 'Returns a CSV file' })
  downloadBalanceTemplate(@Res() res: Response): void {
    const csv = LeaveBalanceBulkImportService.buildTemplateCsvContent();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="leave-balance-import-template.csv"',
    );
    res.send(csv);
  }

  @Post('bulk-import-balances')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk import leave balances from CSV or Excel' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiQuery({ name: 'skipExisting', required: false, type: Boolean })
  @ApiResponse({ status: 200, type: LeaveBalanceBulkImportResultDto })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = [
          'text/csv',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
        ];
        if (allowed.includes(file.mimetype) || file.originalname.match(/\.(csv|xlsx|xls)$/i)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only CSV and Excel files are accepted'), false);
        }
      },
    }),
  )
  async bulkImportLeaveBalances(
    @UploadedFile() file: Express.Multer.File,
    @Query('skipExisting') skipExisting?: string,
  ): Promise<LeaveBalanceBulkImportResultDto> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.leaveBalanceBulkImportService.importFromBuffer(
      file.buffer,
      file.mimetype,
      file.originalname,
      skipExisting === 'true',
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Permanently delete a leave request (HR only)' })
  @ApiParam({ name: 'id', description: 'Leave request ID (CUID)' })
  @ApiResponse({ status: 204, description: 'Deleted successfully' })
  @ApiResponse({ status: 404, description: 'Leave request not found' })
  deleteLeave(
    @Param('id', CuidValidationPipe) id: string,
    @CurrentUser('id') hrId: string,
  ): Promise<void> {
    return this.leavesService.permanentlyDeleteLeave(id, hrId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific leave request' })
  @ApiParam({ name: 'id', description: 'Leave request ID (CUID)' })
  @ApiResponse({ status: 200, type: LeaveRequestResponseDto })
  @ApiResponse({ status: 404, description: 'Leave request not found' })
  getLeave(@Param('id', CuidValidationPipe) id: string): Promise<LeaveRequestResponseDto> {
    return this.leavesService.getLeaveForManagement(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Modify a leave request (HR full control)',
    description:
      'HR can modify any non-terminal leave request at any time — change dates, leave type, reason, or force a new status. ' +
      'If the leave is APPROVED/MODIFIED and details change, it automatically transitions to MODIFIED. ' +
      'All balance changes are synced atomically. A required comment is recorded as the modification reason.',
  })
  @ApiParam({ name: 'id', description: 'Leave request ID (CUID)' })
  @ApiResponse({ status: 200, type: LeaveRequestResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid modification or terminal leave' })
  @ApiResponse({ status: 404, description: 'Leave request not found' })
  modifyLeave(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: HrModifyLeaveRequestDto,
    @CurrentUser('id') hrId: string,
  ): Promise<LeaveRequestResponseDto> {
    return this.leavesService.hrModifyLeave(id, hrId, dto);
  }

  @Post(':id/split')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Split a leave request into multiple parts (HR)',
    description:
      'Cancels the original leave request and creates new APPROVED leave requests for each split portion. ' +
      'Supports splitting at approval time (PENDING) or after approval (APPROVED/MODIFIED). ' +
      'All balance effects are synced atomically in a single transaction.',
  })
  @ApiParam({ name: 'id', description: 'Leave request ID (CUID)' })
  @ApiResponse({ status: 200, type: [LeaveRequestResponseDto] })
  @ApiResponse({ status: 400, description: 'Cannot split a CANCELLED or REJECTED leave' })
  @ApiResponse({ status: 404, description: 'Leave request not found' })
  splitLeave(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: HrSplitLeaveRequestDto,
    @CurrentUser('id') hrId: string,
  ): Promise<LeaveRequestResponseDto[]> {
    return this.leavesService.hrSplitLeave(id, hrId, dto);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Final HR approval of a leave request',
    description:
      'Approves a request (PENDING, TEAM_LEAD_APPROVED, or TEAM_LEAD_REJECTED). ' +
      'Leave balance is atomically deducted upon approval. A mandatory HR comment is required.',
  })
  @ApiParam({ name: 'id', description: 'Leave request ID (CUID)' })
  @ApiResponse({ status: 200, type: LeaveRequestResponseDto })
  @ApiResponse({ status: 400, description: 'Request has not yet been reviewed by a Team Lead' })
  @ApiResponse({ status: 404, description: 'Leave request not found' })
  approveLeave(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: HrReviewLeaveRequestDto,
    @CurrentUser('id') hrId: string,
  ): Promise<LeaveRequestResponseDto> {
    return this.leavesService.hrApprove(id, hrId, dto);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Final HR rejection of a leave request',
    description:
      'Rejects a request after Team Lead review (TEAM_LEAD_APPROVED or TEAM_LEAD_REJECTED). ' +
      'HR cannot reject PENDING requests — Team Lead review is mandatory first. ' +
      'No balance deduction occurs. A mandatory HR comment is required.',
  })
  @ApiParam({ name: 'id', description: 'Leave request ID (CUID)' })
  @ApiResponse({ status: 200, type: LeaveRequestResponseDto })
  @ApiResponse({ status: 400, description: 'Request has not yet been reviewed by a Team Lead' })
  @ApiResponse({ status: 404, description: 'Leave request not found' })
  rejectLeave(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: HrReviewLeaveRequestDto,
    @CurrentUser('id') hrId: string,
  ): Promise<LeaveRequestResponseDto> {
    return this.leavesService.hrReject(id, hrId, dto);
  }

  @Post(':id/approve-wfh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Convert leave to WFH and approve (HR)',
    description:
      'Converts any leave type to WFH and approves it. ' +
      'The WFH counter is incremented while the original leave balance remains unchanged. ' +
      'Category is set to PAID. A mandatory HR comment is required.',
  })
  @ApiParam({ name: 'id', description: 'Leave request ID (CUID)' })
  @ApiResponse({ status: 200, type: LeaveRequestResponseDto })
  @ApiResponse({ status: 404, description: 'Leave request not found' })
  approveAsWfh(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: HrReviewLeaveRequestDto,
    @CurrentUser('id') hrId: string,
  ): Promise<LeaveRequestResponseDto> {
    return this.leavesService.hrApproveAsWfh(id, hrId, dto);
  }

  @Post('apply-special-leave')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Apply a special leave on behalf of an employee',
    description:
      'HR directly applies a special leave (Maternity, Wedding, Umrah/Hajj, Other) for an employee. ' +
      'The leave is created as APPROVED immediately and the balance is deducted atomically. ' +
      'The employee cannot cancel HR-applied leaves.',
  })
  @ApiResponse({ status: 201, type: LeaveRequestResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid leave type or date range' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  applySpecialLeave(
    @Body() dto: HrApplySpecialLeaveDto,
    @CurrentUser('id') hrId: string,
  ): Promise<LeaveRequestResponseDto> {
    return this.leavesService.hrApplySpecialLeave(hrId, dto);
  }

  @Patch('employees/:userId/leave-type-access')
  @ApiOperation({
    summary: 'Enable / disable restricted leave types for an employee',
    description:
      'HR can grant or revoke access to Maternity, Wedding, Umrah/Hajj, and Other leave types ' +
      'on a per-employee basis. Only the fields supplied in the body are updated.',
  })
  @ApiParam({ name: 'userId', description: 'Employee user ID (CUID)' })
  @ApiResponse({ status: 200, type: AllowedLeaveTypesResponseDto })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  updateLeaveTypeAccess(
    @Param('userId', CuidValidationPipe) userId: string,
    @Body() dto: UpdateLeaveTypeAccessDto,
  ): Promise<AllowedLeaveTypesResponseDto> {
    return this.leavesService.updateEmployeeLeaveTypeAccess(userId, dto);
  }
}
