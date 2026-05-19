import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { AclService } from '../rbac/rbac.service';
import { BulkImportService } from './services';
import {
  UserQueryDto,
  ApproveUserDto,
  RejectUserDto,
  ToggleStatusDto,
  UserResponseDto,
  PaginatedUsersResponseDto,
  RoleSelectDto,
  CreateEmployeeDto,
  UpdateEmployeeDto,
  BulkImportResultDto,
  SalaryReportQueryDto,
  BulkWelcomeEmailDto,
} from './dto';
import { RequireEntity, CurrentUser, CuidValidationPipe, Public } from '../common';

@ApiTags('Admin - Users')
@ApiBearerAuth('JWT-auth')
@Controller('admin/users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly aclService: AclService,
    private readonly bulkImportService: BulkImportService,
  ) {}

  @Get()
  @RequireEntity('user', 'project', 'system-config')
  @ApiOperation({
    summary: 'Get all users with filters and pagination',
    description:
      'Admin endpoint to list all users. Supports filtering by approval status, search, and pagination.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of users',
    type: PaginatedUsersResponseDto,
  })
  async findAll(
    @Query() query: UserQueryDto,
    @CurrentUser() currentUser: { id: string; isSystem: boolean },
  ): Promise<PaginatedUsersResponseDto> {
    return this.usersService.findAll(query, currentUser.isSystem);
  }

  @Post()
  @RequireEntity('user', 'role')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create employee (HR/admin-created user)',
    description:
      'Create a new employee/user directly (no registration flow). Stores salary and leave balances, marks user as APPROVED, and assigns role(s).',
  })
  @ApiResponse({
    status: 201,
    description: 'Employee created successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 409, description: 'User already exists' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async createEmployee(
    @Body() dto: CreateEmployeeDto,
    @CurrentUser('id') adminId: string,
  ): Promise<UserResponseDto> {
    return this.usersService.createEmployee(dto, adminId);
  }

  @Get('next-employee-id')
  @RequireEntity('user')
  @ApiOperation({ summary: 'Get next auto-generated employee ID' })
  @ApiResponse({
    status: 200,
    schema: { type: 'object', properties: { employeeId: { type: 'string', example: 'DL_0005' } } },
  })
  async getNextEmployeeId(): Promise<{ employeeId: string }> {
    const employeeId = await this.usersService.getNextEmployeeId();
    return { employeeId };
  }

  @Get('pending')
  @RequireEntity('user')
  @ApiOperation({
    summary: 'Get pending approval requests',
    description: 'Shorthand endpoint to get only users with PENDING approval status.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of pending approval requests',
    type: PaginatedUsersResponseDto,
  })
  async findPending(
    @Query() query: UserQueryDto,
    @CurrentUser() currentUser: { id: string; isSystem: boolean },
  ): Promise<PaginatedUsersResponseDto> {
    return this.usersService.findPendingRequests(query, currentUser.isSystem);
  }

  @Get('stats')
  @RequireEntity('user')
  @ApiOperation({
    summary: 'Get approval statistics',
    description: 'Get counts of pending, approved, and rejected users.',
  })
  @ApiResponse({
    status: 200,
    description: 'Approval statistics',
    schema: {
      type: 'object',
      properties: {
        pending: { type: 'number' },
        approved: { type: 'number' },
        rejected: { type: 'number' },
        total: { type: 'number' },
      },
    },
  })
  async getStats(): Promise<{
    pending: number;
    approved: number;
    rejected: number;
    total: number;
  }> {
    return this.usersService.getApprovalStats();
  }

  @Get('hr-dashboard')
  @RequireEntity('user')
  @ApiOperation({
    summary: 'Get HR dashboard statistics',
    description:
      'Aggregated statistics for the HR dashboard: headcount, departments, leaves, salary, onboarding status and recent employees.',
  })
  @ApiResponse({ status: 200, description: 'HR dashboard statistics' })
  async getHrDashboard(): Promise<Record<string, unknown>> {
    return this.usersService.getHrDashboardStats() as unknown as Promise<Record<string, unknown>>;
  }

  @Get('salary-report')
  @RequireEntity('user')
  @ApiOperation({
    summary: 'Get paginated salary/payroll report',
    description:
      'Returns a paginated list of approved employees with their salary data. Supports filtering by department, employee type, status, and free-text search. Restricted to users with the "user" entity permission.',
  })
  @ApiResponse({ status: 200, description: 'Salary report data' })
  async getSalaryReport(@Query() query: SalaryReportQueryDto): Promise<Record<string, unknown>> {
    return this.usersService.getSalaryReport(query) as unknown as Promise<Record<string, unknown>>;
  }

  @Get('roles')
  @RequireEntity('user', 'role')
  @ApiOperation({
    summary: 'Get roles list for user assignment',
    description:
      'Get a simplified list of all roles. When userId is provided, includes isAssigned and isPrimary fields for that user.',
  })
  @ApiQuery({
    name: 'userId',
    required: false,
    description:
      'Optional user ID — when provided, each role includes isAssigned and isPrimary flags for that user',
  })
  @ApiResponse({
    status: 200,
    description: 'List of roles',
    type: [RoleSelectDto],
  })
  async getRoles(@Query('userId') userId?: string): Promise<RoleSelectDto[]> {
    return this.aclService.getRolesForSelection(userId);
  }

  @Post('bulk-welcome-email')
  @RequireEntity('user')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send welcome/credentials email to multiple users in bulk',
    description:
      'Sends a welcome email (first time) or credentials-only email (resend) to up to 100 users at once. Returns per-user success/failure details.',
  })
  @ApiResponse({
    status: 200,
    description: 'Bulk email results',
    schema: {
      type: 'object',
      properties: {
        sent: { type: 'number' },
        failed: { type: 'number' },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              userId: { type: 'string' },
              email: { type: 'string' },
              success: { type: 'boolean' },
              isResend: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
  })
  async bulkSendWelcomeEmail(@Body() dto: BulkWelcomeEmailDto): Promise<{
    sent: number;
    failed: number;
    results: Array<{
      userId: string;
      email: string;
      success: boolean;
      isResend: boolean;
      error?: string;
    }>;
  }> {
    return this.usersService.bulkSendWelcomeEmail(dto.userIds);
  }

  @Post('bulk-import')
  @RequireEntity('user')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
      fileFilter: (_req, file, cb) => {
        const allowed = [
          'text/csv',
          'application/csv',
          'text/plain',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
        ];
        if (allowed.includes(file.mimetype) || file.originalname.match(/\.(csv|xlsx|xls)$/i)) {
          cb(null, true);
        } else {
          cb(new Error('Only CSV and Excel files are allowed'), false);
        }
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'CSV or Excel file' },
      },
      required: ['file'],
    },
  })
  @ApiOperation({
    summary: 'Bulk import employees from CSV or Excel',
    description:
      'Upload a CSV or Excel file to create multiple employees at once. Returns per-row success/failure details. Max 500 rows, 5 MB. Pass skipExisting=true to silently skip rows whose email already exists.',
  })
  @ApiQuery({
    name: 'skipExisting',
    required: false,
    type: Boolean,
    description:
      'When true, rows with an already-existing email are silently skipped instead of counted as failures',
  })
  @ApiQuery({
    name: 'updateExisting',
    required: false,
    type: Boolean,
    description:
      'When true, rows whose email already exists are updated in place (only non-empty fields are changed). Takes precedence over skipExisting.',
  })
  @ApiResponse({
    status: 200,
    description: 'Import completed (check results for per-row status)',
    type: BulkImportResultDto,
  })
  async bulkImport(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') adminId: string,
    @Query('skipExisting') skipExisting?: string,
    @Query('updateExisting') updateExisting?: string,
  ): Promise<BulkImportResultDto> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.bulkImportService.importFromBuffer(
      file.buffer,
      file.mimetype,
      file.originalname,
      adminId,
      skipExisting === 'true',
      updateExisting === 'true',
    );
  }

  @Get('bulk-import/template')
  @Public()
  @ApiOperation({
    summary: 'Download CSV template for bulk import',
    description: 'Returns a sample CSV file with all supported columns and one example row.',
  })
  @ApiResponse({ status: 200, description: 'CSV file download' })
  downloadTemplate(@Res() res: Response): void {
    const csv = BulkImportService.buildTemplateCsvContent();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bulk-import-template.csv"');
    res.send(csv);
  }

  @Get('bulk-import/export')
  @RequireEntity('user')
  @ApiOperation({
    summary: 'Export all users as CSV for bulk import',
    description:
      'Returns a CSV file with all users pre-filled in bulk-import format. HR can edit and re-import.',
  })
  @ApiResponse({ status: 200, description: 'CSV file download' })
  async downloadBulkExport(@Res() res: Response): Promise<void> {
    const csv = await this.bulkImportService.buildExportCsvContent();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="users-bulk-export.csv"');
    res.send(csv);
  }

  @Get(':id')
  @RequireEntity('user', 'requests')
  @ApiOperation({
    summary: 'Get user by ID',
    description: 'Get detailed information about a specific user.',
  })
  @ApiParam({ name: 'id', description: 'User ID (CUID format)' })
  @ApiResponse({
    status: 200,
    description: 'User details',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid ID format' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(@Param('id', CuidValidationPipe) id: string): Promise<UserResponseDto> {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @RequireEntity('user')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update employee details (HR)',
    description:
      'Update employee fields such as department, designation, joining date, salary, and leave balances. Role changes should use the role-assignment endpoint.',
  })
  @ApiParam({ name: 'id', description: 'User ID (CUID format)' })
  @ApiResponse({
    status: 200,
    description: 'Employee updated successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid ID format' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateEmployee(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ): Promise<UserResponseDto> {
    return this.usersService.updateEmployee(id, dto);
  }

  @Post(':id/send-welcome-email')
  @RequireEntity('user')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send welcome email or reset password credentials',
    description:
      'First time: sends welcome email with temp password. Reset: sends credentials-only email. HR can resend anytime.',
  })
  @ApiParam({ name: 'id', description: 'User ID (CUID format)' })
  @ApiResponse({
    status: 200,
    description: 'Email sent successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        queuedTo: { type: 'array', items: { type: 'string' } },
        welcomeEmailSentAt: { type: 'string', format: 'date-time' },
        isResend: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async sendWelcomeEmail(@Param('id', CuidValidationPipe) id: string): Promise<{
    message: string;
    queuedTo: string[];
    welcomeEmailSentAt: Date;
    isResend: boolean;
  }> {
    return this.usersService.sendWelcomeEmail(id);
  }

  @Patch(':id/approve')
  @RequireEntity('user')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a user',
    description: 'Approve a pending user and assign them a role.',
  })
  @ApiParam({ name: 'id', description: 'User ID to approve' })
  @ApiResponse({
    status: 200,
    description: 'User approved successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 400, description: 'User already processed' })
  @ApiResponse({ status: 403, description: 'Cannot approve yourself' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async approve(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: ApproveUserDto,
    @CurrentUser('id') adminId: string,
  ): Promise<UserResponseDto> {
    return this.usersService.approveUser(id, adminId, dto);
  }

  @Patch(':id/reject')
  @RequireEntity('user')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject a user',
    description: 'Reject a pending user with an optional reason.',
  })
  @ApiParam({ name: 'id', description: 'User ID to reject (CUID format)' })
  @ApiResponse({
    status: 200,
    description: 'User rejected successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid ID format or user already processed' })
  @ApiResponse({ status: 403, description: 'Cannot reject yourself' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async reject(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: RejectUserDto,
    @CurrentUser('id') adminId: string,
  ): Promise<UserResponseDto> {
    return this.usersService.rejectUser(id, adminId, dto);
  }

  @Patch(':id/status')
  @RequireEntity('user')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Toggle user access status',
    description:
      'Toggle or set user account access status. When revoking access, all user tokens are invalidated immediately. Admin cannot change their own status.',
  })
  @ApiParam({ name: 'id', description: 'User ID to toggle status' })
  @ApiResponse({
    status: 200,
    description: 'User status updated successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Cannot change your own status' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async toggleStatus(
    @Param('id', CuidValidationPipe) id: string,
    @Body() dto: ToggleStatusDto,
    @CurrentUser('id') adminId: string,
  ): Promise<UserResponseDto> {
    return this.usersService.toggleUserStatus(id, adminId, dto);
  }
}
