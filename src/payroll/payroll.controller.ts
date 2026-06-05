import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PayrollService } from './payroll.service';
import { PayrollBulkAdjustmentService } from './payroll-bulk-adjustment.service';
import { PayrollXlsxExportService } from './payroll-xlsx-export.service';
import { PayrollRemittanceExportService } from './payroll-remittance-export.service';
import {
  BulkAdjustmentQueryDto,
  BulkConflictMode,
  BulkUpdateVariablesDto,
  CreatePayrollPeriodDto,
  DesignateTempAuthorizerDto,
  PayrollLinesQueryDto,
  RejectPayrollReviewDto,
  UpdatePayrollLineDto,
  UpsertPayrollProfileDto,
} from './dto';
import { RequireEntity, CurrentUser, CuidValidationPipe } from 'src/common';
import { AclService } from 'src/rbac/rbac.service';

@ApiTags('Admin - Payroll')
@ApiBearerAuth('JWT-auth')
@Controller('admin/payroll')
@RequireEntity('payroll')
export class PayrollController {
  constructor(
    private readonly payrollService: PayrollService,
    private readonly bulkAdjustmentService: PayrollBulkAdjustmentService,
    private readonly xlsxExportService: PayrollXlsxExportService,
    private readonly remittanceExportService: PayrollRemittanceExportService,
    private readonly aclService: AclService,
  ) {}

  private async requireAction(userId: string, action: string): Promise<void> {
    const allowed = await this.aclService.userHasEntityAction(userId, 'payroll', action);
    if (!allowed) {
      throw new ForbiddenException(`Payroll '${action}' permission required`);
    }
  }

  // ── Periods ───────────────────────────────────────────────────────────────

  @Get('periods')
  @ApiOperation({ summary: 'List all payroll periods ordered newest first' })
  @ApiResponse({ status: 200, description: 'Array of payroll period objects' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async listPeriods(@CurrentUser('id') _userId: string) {
    // await this.requireAction(userId, 'read');
    return this.payrollService.listPeriods();
  }

  @Post('periods')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new payroll period',
    description:
      'Creates a DRAFT payroll period for the given month and seeds one line per active employee. Fails with 409 if the period already exists.',
  })
  @ApiResponse({ status: 201, description: 'Payroll period created' })
  @ApiResponse({ status: 400, description: 'Invalid yearMonth format' })
  @ApiResponse({ status: 403, description: 'payroll:write permission required' })
  @ApiResponse({ status: 409, description: 'Period already exists for this month' })
  async createPeriod(@Body() dto: CreatePayrollPeriodDto, @CurrentUser('id') actorId: string) {
    await this.requireAction(actorId, 'write');
    return this.payrollService.createPeriod(dto, actorId);
  }

  @Get('periods/:periodId')
  @ApiOperation({ summary: 'Get a single payroll period by ID' })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiResponse({ status: 200, description: 'Payroll period object' })
  @ApiResponse({ status: 404, description: 'Period not found' })
  async getPeriod(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @CurrentUser('id') _userId: string,
  ) {
    // await this.requireAction(_userId, 'read');
    return this.payrollService.getPeriod(periodId);
  }

  @Post('periods/:periodId/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh lines from HR data and recalculate',
    description:
      'Re-fetches salary, allowances, leaves, loans and advances for every employee, then recalculates all lines. Only allowed on DRAFT periods.',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiResponse({ status: 200, description: 'Refresh complete — returns summary stats' })
  @ApiResponse({ status: 403, description: 'payroll:write permission required' })
  @ApiResponse({ status: 404, description: 'Period not found' })
  async refreshLines(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @CurrentUser('id') actorId: string,
  ) {
    await this.requireAction(actorId, 'write');
    return this.payrollService.refreshLines(periodId, actorId);
  }

  @Post('periods/:periodId/recalculate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recalculate all lines without re-fetching HR data',
    description:
      'Re-runs the calculation engine on existing line inputs. Useful after editing lines manually.',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiResponse({ status: 200, description: '{ success: true }' })
  @ApiResponse({ status: 403, description: 'payroll:write permission required' })
  @ApiResponse({ status: 404, description: 'Period not found' })
  async recalculate(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @CurrentUser('id') actorId: string,
  ) {
    await this.requireAction(actorId, 'write');
    await this.payrollService.recalculatePeriod(periodId, actorId);
    return { success: true as const };
  }

  // ── Lines ─────────────────────────────────────────────────────────────────

  @Get('periods/:periodId/lines')
  @ApiOperation({
    summary: 'List paginated payroll lines',
    description:
      'Returns calculated payroll lines for the period. Supports filtering by department, status, type and free-text search.',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiResponse({ status: 200, description: 'Paginated list of payroll lines' })
  @ApiResponse({ status: 404, description: 'Period not found' })
  async listLines(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @Query() query: PayrollLinesQueryDto,
    @CurrentUser('id') _userId: string,
  ) {
    return this.payrollService.listLines(periodId, query);
  }

  @Post('periods/:periodId/lines/:lineId/refresh')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Re-sync HR data for a single payroll line and recalculate',
    description:
      'Fetches latest salary, allowances, leaves and deductions for this employee only, then recalculates their line.',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiParam({ name: 'lineId', description: 'CUID of the payroll line' })
  @ApiResponse({ status: 204, description: 'Line refreshed' })
  @ApiResponse({ status: 403, description: 'payroll:write permission required' })
  @ApiResponse({ status: 404, description: 'Period or line not found' })
  async refreshSingleLine(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @Param('lineId', CuidValidationPipe) lineId: string,
    @CurrentUser('id') actorId: string,
  ) {
    await this.requireAction(actorId, 'write');
    await this.payrollService.refreshSingleLine(periodId, lineId, actorId);
  }

  // NOTE: this literal route must be declared before the `:lineId` PATCH below so that
  // "bulk-variables" is not captured as a lineId param (which would fail CUID validation).
  @Patch('periods/:periodId/lines/bulk-variables')
  @ApiOperation({
    summary: 'Bulk overwrite performance bonus, extra working days and penalties',
    description:
      'Applies absolute values for performanceBonus, extraWorkingDays and fines across many payroll lines in one call, writing an audit row per changed field and recalculating each affected line. Used by the "Bulk Edit Variables" grid modal.',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiResponse({ status: 200, description: 'Summary of applied/skipped lines' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({
    status: 403,
    description: 'payroll:write permission required or period not editable',
  })
  @ApiResponse({ status: 404, description: 'Period not found' })
  async bulkUpdateVariables(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @Body() dto: BulkUpdateVariablesDto,
    @CurrentUser('id') actorId: string,
  ) {
    await this.requireAction(actorId, 'write');
    return this.payrollService.bulkUpdateVariables(periodId, dto.updates, actorId);
  }

  @Patch('periods/:periodId/lines/:lineId')
  @ApiOperation({
    summary: 'Update manual adjustments on a payroll line',
    description:
      'Updates editable fields (overtime, bonus, deductions, allowances, etc.) and immediately recalculates the line. Uses optimistic concurrency — include the current `version` to detect conflicts (409).',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiParam({ name: 'lineId', description: 'CUID of the payroll line' })
  @ApiResponse({ status: 200, description: 'Updated payroll line' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 403, description: 'payroll:write permission required' })
  @ApiResponse({ status: 404, description: 'Period or line not found' })
  @ApiResponse({
    status: 409,
    description: 'Optimistic lock conflict — line was modified by another user',
  })
  async updateLine(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @Param('lineId', CuidValidationPipe) lineId: string,
    @Body() dto: UpdatePayrollLineDto,
    @CurrentUser('id') actorId: string,
  ) {
    await this.requireAction(actorId, 'write');
    return this.payrollService.updateLine(periodId, lineId, dto, actorId);
  }

  // ── Line sub-resources ────────────────────────────────────────────────────

  @Get('periods/:periodId/users/:userId/leaves')
  @ApiOperation({ summary: 'HR-approved leaves for a user in the period month' })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiParam({ name: 'userId', description: 'CUID of the employee' })
  @ApiResponse({ status: 200, description: 'Array of approved leave records' })
  @ApiResponse({ status: 404, description: 'Period not found' })
  async getApprovedLeavesForLine(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @Param('userId', CuidValidationPipe) userId: string,
    @CurrentUser('id') _actorId: string,
  ) {
    return this.payrollService.getApprovedLeavesForLine(periodId, userId);
  }

  @Get('periods/:periodId/users/:userId/hr-claims')
  @ApiOperation({
    summary: 'HR-approved salary-adjustment reimbursements for a user in the period month',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiParam({ name: 'userId', description: 'CUID of the employee' })
  @ApiResponse({ status: 200, description: 'Array of HR reimbursement claims' })
  @ApiResponse({ status: 404, description: 'Period not found' })
  async getHrClaimsForLine(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @Param('userId', CuidValidationPipe) userId: string,
    @CurrentUser('id') _actorId: string,
  ) {
    return this.payrollService.getHrClaimsForLine(periodId, userId);
  }

  @Get('periods/:periodId/users/:userId/advance-salary')
  @ApiOperation({ summary: 'Active advance salary repayments for a user in the period month' })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiParam({ name: 'userId', description: 'CUID of the employee' })
  @ApiResponse({ status: 200, description: 'Array of advance salary repayment schedules' })
  @ApiResponse({ status: 404, description: 'Period not found' })
  async getActiveAdvanceSalaryRepaymentsForLine(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @Param('userId', CuidValidationPipe) userId: string,
    @CurrentUser('id') _actorId: string,
  ) {
    return this.payrollService.getActiveAdvanceSalaryRepaymentsForLine(periodId, userId);
  }

  @Get('periods/:periodId/users/:userId/loans')
  @ApiOperation({ summary: 'Active loan repayments for a user in the period month' })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiParam({ name: 'userId', description: 'CUID of the employee' })
  @ApiResponse({ status: 200, description: 'Array of loan repayment installments' })
  @ApiResponse({ status: 404, description: 'Period not found' })
  async getActiveLoanRepaymentsForLine(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @Param('userId', CuidValidationPipe) userId: string,
    @CurrentUser('id') _actorId: string,
  ) {
    // await this.requireAction(_actorId, 'read');
    return this.payrollService.getActiveLoanRepaymentsForLine(periodId, userId);
  }

  // ── Analytics / Financial Overview ──────────────────────────────────────────

  @Get('periods/:periodId/analytics')
  @ApiOperation({
    summary: 'High-level financial KPIs for a payroll period',
    description:
      'Aggregates payroll lines into leadership-facing metrics: total users paid, total taxes paid, ' +
      'total deductions, and total reimbursements (plus per-category breakdowns). An open period ' +
      'reflects live workspace edits; a LOCKED period returns the frozen snapshot. Restricted to ' +
      "users with the payroll 'read' permission (Super Admins, HR Managers, Executives).",
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiResponse({ status: 200, description: 'Aggregated payroll analytics for the period' })
  @ApiResponse({ status: 403, description: "payroll 'read' permission required" })
  @ApiResponse({ status: 404, description: 'Period not found' })
  async getAnalytics(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.requireAction(userId, 'read');
    return this.payrollService.getPeriodAnalytics(periodId);
  }

  @Get('analytics/compare')
  @ApiOperation({
    summary: 'Side-by-side analytics for an explicit set of payroll months',
    description:
      'Returns aggregated KPIs for each requested month (YYYY-MM), for the interactive ' +
      'multi-month comparison. Months are passed as a comma-separated `months` query param ' +
      "(max 12). Restricted to users with the payroll 'read' permission.",
  })
  @ApiQuery({
    name: 'months',
    description: 'Comma-separated list of YYYY-MM months to compare',
    example: '2026-06,2026-05,2026-03',
  })
  @ApiResponse({ status: 200, description: 'Per-month analytics, ascending by month' })
  @ApiResponse({ status: 400, description: 'Missing or malformed months' })
  @ApiResponse({ status: 403, description: "payroll 'read' permission required" })
  async compareAnalytics(@Query('months') months: string, @CurrentUser('id') userId: string) {
    await this.requireAction(userId, 'read');
    const list = (months ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    return this.payrollService.getAnalyticsComparison(list);
  }

  // ── Export Metadata ───────────────────────────────────────────────────────

  @Get('periods/:periodId/export-metadata')
  @ApiOperation({
    summary: 'Checksum metadata: UI net sum vs exportable net sum',
    description:
      'Returns net salary sums broken down by payment mode. Used to validate checksums before exporting.',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiResponse({ status: 200, description: 'Export metadata with net salary sums' })
  @ApiResponse({ status: 404, description: 'Period not found' })
  async exportMetadata(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @CurrentUser('id') _userId: string,
  ) {
    // await this.requireAction(_userId, 'read');
    return this.payrollService.getExportMetadata(periodId);
  }

  // ── Standard CSV Export ────────────────────────────────────────────────────

  @Post('periods/:periodId/export-csv')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Download generic UTF-8 CSV (Name, IBAN, Net Salary)',
    description:
      'Locks the period and returns a CSV with one row per payable employee. Response headers include X-Payroll-Checksum and X-Payroll-Row-Count.',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiProduces('text/csv')
  @ApiResponse({ status: 200, description: 'CSV file download' })
  @ApiResponse({
    status: 403,
    description: 'payroll:export permission required or period not authorized',
  })
  @ApiResponse({ status: 404, description: 'Period not found' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (5 exports / 60 s)' })
  async exportCsv(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @CurrentUser('id') actorId: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    await this.requireAction(actorId, 'export');
    const { csvBody, checksum, rowCount, yearMonth } = await this.payrollService.exportCsvAndLock(
      periodId,
      actorId,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="payroll-export-${yearMonth}.csv"`);
    res.setHeader('X-Payroll-Checksum', String(checksum));
    res.setHeader('X-Payroll-Row-Count', String(rowCount));
    res.send(Buffer.from(csvBody, 'utf8'));
  }

  // ── Local Bank CSV Export ──────────────────────────────────────────────────

  @Post('periods/:periodId/export-local-bank-csv')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Download strict-format local bank CSV',
    description:
      'Exports LOCAL_BANK employees in the format required by the bank upload portal: Customer Ref · PAY · BA · Bank Code · Account Holder Name · Account Number · Amount. Returns 400 with a validationErrors array if any employee is missing required bank fields.',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiProduces('text/csv', 'application/json')
  @ApiResponse({ status: 200, description: 'CSV file download' })
  @ApiResponse({
    status: 400,
    description: 'One or more employees are missing bank details — returns validationErrors array',
  })
  @ApiResponse({
    status: 403,
    description: 'payroll:export permission required or period not authorized',
  })
  @ApiResponse({ status: 404, description: 'Period not found' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (5 exports / 60 s)' })
  async exportLocalBankCsv(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @CurrentUser('id') actorId: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    await this.requireAction(actorId, 'export');
    const result = await this.payrollService.exportLocalBankCsvAndLock(periodId, actorId);

    if (result.validationErrors.length > 0) {
      res.status(400).json({
        statusCode: 400,
        message: 'Some employees are missing bank details required for local bank export',
        validationErrors: result.validationErrors,
      });
      return;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="local-bank-${result.yearMonth}.csv"`,
    );
    res.setHeader('X-Payroll-Checksum', String(result.checksum));
    res.setHeader('X-Payroll-Row-Count', String(result.rowCount));
    res.send(Buffer.from(result.csvBody, 'utf8'));
  }

  // ── Advanced XLSX Export ───────────────────────────────────────────────────

  @Post('periods/:periodId/export-xlsx')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Download full payroll XLSX workbook',
    description:
      'Returns a multi-sheet XLSX: (1) Payment Summary — all employees, negative net highlighted; (2) Full Breakdown — gross/deduction/net columns per employee; (3) Line Items Detail — one column per HR reimbursement / loan / advance installment; (4) Audit Trail. Does NOT lock the period.',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiResponse({ status: 200, description: 'XLSX file download' })
  @ApiResponse({
    status: 403,
    description: 'payroll:export permission required or period not authorized',
  })
  @ApiResponse({ status: 404, description: 'Period not found' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (5 exports / 60 s)' })
  async exportXlsx(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @CurrentUser('id') actorId: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    await this.requireAction(actorId, 'export');
    const { buffer, filename, checksum } =
      await this.xlsxExportService.generateAdvancedXlsx(periodId);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Payroll-Checksum', String(checksum));
    res.send(buffer);
  }

  // ── Remittance XLSX Export ─────────────────────────────────────────────────

  @Post('periods/:periodId/export-remittance-xlsx')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Download remittance XLSX for international (UAE) transfers',
    description:
      'Exports CONSULTANT and UAE-payment-mode employees in the bank remittance format. Employees with missing bank fields (IBAN, SWIFT, city, province, etc.) are skipped and listed in the response headers / validationErrors. Valid employees are always exported — only all-invalid produces an empty file with a 400 response.',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/json',
  )
  @ApiResponse({
    status: 200,
    description:
      'XLSX file download (may include X-Payroll-Validation-Warnings header listing skipped employees)',
  })
  @ApiResponse({
    status: 400,
    description:
      'No exportable rows — all employees had validation errors or were hold/deactivated',
  })
  @ApiResponse({
    status: 403,
    description: 'payroll:export permission required or period not authorized',
  })
  @ApiResponse({ status: 404, description: 'Period not found' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (5 exports / 60 s)' })
  async exportRemittanceXlsx(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @CurrentUser('id') actorId: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    await this.requireAction(actorId, 'export');
    const result = await this.remittanceExportService.exportRemittanceXlsx(periodId, actorId);

    if (result.validationErrors.length > 0 && result.rowCount === 0) {
      res.status(400).json({
        statusCode: 400,
        message: 'No exportable rows — all employees had validation errors or were skipped',
        validationErrors: result.validationErrors,
      });
      return;
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-Payroll-Checksum', String(result.checksum));
    res.setHeader('X-Payroll-Row-Count', String(result.rowCount));
    if (result.validationErrors.length > 0) {
      res.setHeader(
        'X-Payroll-Validation-Warnings',
        result.validationErrors.map((e) => e.name).join(', '),
      );
    }
    res.send(result.buffer);
  }

  // ── Authorization Lifecycle ────────────────────────────────────────────────

  @Post('periods/:periodId/submit-for-review')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Submit payroll period for review',
    description: 'Transitions period from DRAFT → UNDER_REVIEW. Notifies the primary authorizer.',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiResponse({ status: 204, description: 'Submitted for review' })
  @ApiResponse({
    status: 403,
    description: 'payroll:authorize permission required or invalid status transition',
  })
  @ApiResponse({ status: 404, description: 'Period not found' })
  async submitForReview(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @CurrentUser('id') actorId: string,
  ): Promise<void> {
    await this.requireAction(actorId, 'authorize');
    await this.payrollService.submitForReview(periodId, actorId);
  }

  @Post('periods/:periodId/authorize')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Authorize payroll period — unlocks exports',
    description:
      'Transitions period from UNDER_REVIEW → AUTHORIZED. Only the designated primary or temporary authorizer may call this.',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiResponse({ status: 204, description: 'Period authorized' })
  @ApiResponse({
    status: 403,
    description: 'payroll:authorize permission required or caller is not the designated authorizer',
  })
  @ApiResponse({ status: 404, description: 'Period not found' })
  async authorizePayroll(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @CurrentUser('id') actorId: string,
  ): Promise<void> {
    await this.requireAction(actorId, 'authorize');
    await this.payrollService.authorizePayroll(periodId, actorId);
  }

  @Post('periods/:periodId/reject-review')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Reject review — send period back to DRAFT',
    description:
      'Transitions UNDER_REVIEW → DRAFT and optionally attaches a comment for the submitter.',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiResponse({ status: 204, description: 'Period returned to draft' })
  @ApiResponse({ status: 403, description: 'payroll:authorize permission required' })
  @ApiResponse({ status: 404, description: 'Period not found' })
  async rejectReview(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @Body() dto: RejectPayrollReviewDto,
    @CurrentUser('id') actorId: string,
  ): Promise<void> {
    await this.requireAction(actorId, 'authorize');
    await this.payrollService.rejectReview(periodId, actorId, dto);
  }

  @Post('periods/:periodId/revoke-authorization')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke authorization — re-locks exports',
    description: 'Transitions AUTHORIZED → DRAFT. Exports become unavailable until re-authorized.',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiResponse({ status: 204, description: 'Authorization revoked' })
  @ApiResponse({ status: 403, description: 'payroll:authorize permission required' })
  @ApiResponse({ status: 404, description: 'Period not found' })
  async revokeAuthorization(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @CurrentUser('id') actorId: string,
  ): Promise<void> {
    await this.requireAction(actorId, 'authorize');
    await this.payrollService.revokeAuthorization(periodId, actorId);
  }

  @Post('periods/:periodId/recall')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Recall period from review back to DRAFT',
    description:
      'Can only be called by the original HR submitter while the period is UNDER_REVIEW.',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiResponse({ status: 204, description: 'Period recalled to draft' })
  @ApiResponse({
    status: 403,
    description: 'payroll:authorize permission required or caller is not the submitter',
  })
  @ApiResponse({ status: 404, description: 'Period not found' })
  async recallFromReview(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @CurrentUser('id') actorId: string,
  ): Promise<void> {
    await this.requireAction(actorId, 'authorize');
    await this.payrollService.recallFromReview(periodId, actorId);
  }

  @Patch('periods/:periodId/temp-authorizer')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Designate a temporary authorizer for this period',
    description: 'Super-admin only. Allows a different user to authorize this specific period.',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiResponse({ status: 204, description: 'Temporary authorizer set' })
  @ApiResponse({ status: 400, description: 'Invalid userId' })
  @ApiResponse({ status: 403, description: 'payroll:authorize permission required' })
  @ApiResponse({ status: 404, description: 'Period or user not found' })
  async designateTempAuthorizer(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @Body() dto: DesignateTempAuthorizerDto,
    @CurrentUser('id') actorId: string,
  ): Promise<void> {
    await this.requireAction(actorId, 'authorize');
    await this.payrollService.designateTempAuthorizer(periodId, dto.userId, actorId);
  }

  // ── Lock / Unlock ─────────────────────────────────────────────────────────

  @Post('periods/:periodId/lock')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Lock a payroll period — prevents further edits',
    description: 'Period must be AUTHORIZED. Once locked, lines cannot be edited until unlocked.',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiResponse({ status: 204, description: 'Period locked' })
  @ApiResponse({ status: 403, description: 'payroll:lock permission required' })
  @ApiResponse({ status: 404, description: 'Period not found' })
  async lockPeriod(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @CurrentUser('id') actorId: string,
  ): Promise<void> {
    await this.requireAction(actorId, 'lock');
    await this.payrollService.lockPeriod(periodId, actorId);
  }

  @Post('periods/:periodId/unlock')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Unlock a payroll period — re-enables edits',
    description: 'Transitions LOCKED → AUTHORIZED. Lines become editable again.',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiResponse({ status: 204, description: 'Period unlocked' })
  @ApiResponse({ status: 403, description: 'payroll:lock permission required' })
  @ApiResponse({ status: 404, description: 'Period not found' })
  async unlockPeriod(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @CurrentUser('id') actorId: string,
  ): Promise<void> {
    await this.requireAction(actorId, 'lock');
    await this.payrollService.unlockPeriod(periodId, actorId);
  }

  // ── Bulk Adjustments ──────────────────────────────────────────────────────

  @Get('periods/:periodId/bulk-adjustments/template')
  @ApiOperation({
    summary: 'Download CSV template for bulk adjustments',
    description:
      'Returns a CSV with headers: Employee ID, Bonus, Deduction, Extra Working Days. Fill in rows and POST back to apply.',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiProduces('text/csv')
  @ApiResponse({ status: 200, description: 'CSV template file download' })
  @ApiResponse({ status: 403, description: 'payroll:write permission required' })
  async getBulkAdjustmentTemplate(
    @Param('periodId', CuidValidationPipe) _periodId: string,
    @CurrentUser('id') actorId: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    await this.requireAction(actorId, 'write');
    const csv = this.bulkAdjustmentService.generateTemplate();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="bulk-adjustments-template.csv"');
    res.send(Buffer.from(csv, 'utf8'));
  }

  @Post('periods/:periodId/bulk-adjustments')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = [
          'text/csv',
          'application/csv',
          'text/plain',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
        ];
        if (allowed.includes(file.mimetype) || /\.(csv|xlsx|xls)$/i.test(file.originalname)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only CSV and Excel files are allowed'), false);
        }
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'CSV or XLSX file containing bulk adjustment rows',
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'CSV or XLSX file (max 10 MB)' },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload CSV/XLSX of bulk adjustments',
    description:
      'Parses each row and applies bonus, deduction and extra-working-days overrides to matching payroll lines. Use dryRun=true (default) to preview without saving. conflictMode=OVERWRITE replaces existing values; ADD adds to them.',
  })
  @ApiQuery({
    name: 'dryRun',
    required: false,
    type: Boolean,
    description: 'Preview only — no changes saved (default: true)',
  })
  @ApiQuery({
    name: 'conflictMode',
    required: false,
    enum: ['OVERWRITE', 'ADD'],
    description: 'How to handle existing values (default: OVERWRITE)',
  })
  @ApiParam({ name: 'periodId', description: 'CUID of the payroll period' })
  @ApiResponse({ status: 200, description: 'Bulk adjustment result with per-row status' })
  @ApiResponse({ status: 400, description: 'No file uploaded or unsupported file type' })
  @ApiResponse({ status: 403, description: 'payroll:write permission required' })
  @ApiResponse({ status: 404, description: 'Period not found' })
  async uploadBulkAdjustments(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @Query() query: BulkAdjustmentQueryDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') actorId: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    await this.requireAction(actorId, 'write');
    return this.bulkAdjustmentService.processFile(
      file.buffer,
      file.mimetype,
      periodId,
      actorId,
      query.dryRun !== false,
      query.conflictMode ?? BulkConflictMode.OVERWRITE,
    );
  }

  // ── Payroll Profile ───────────────────────────────────────────────────────

  @Patch('users/:userId/profile')
  @ApiOperation({
    summary: 'Upsert payroll profile for a user',
    description:
      "Creates or updates rental allowance, commute allowance and consultant pay defaults on the user's payroll profile. Does not affect any existing payroll lines — run recalculate after updating.",
  })
  @ApiParam({ name: 'userId', description: 'CUID of the employee' })
  @ApiResponse({ status: 200, description: 'Updated payroll profile' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 403, description: 'payroll:write permission required' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async upsertProfile(
    @Param('userId', CuidValidationPipe) userId: string,
    @Body() dto: UpsertPayrollProfileDto,
    @CurrentUser('id') actorId: string,
  ) {
    await this.requireAction(actorId, 'write');
    return this.payrollService.upsertPayrollProfile(userId, dto, actorId);
  }
}
