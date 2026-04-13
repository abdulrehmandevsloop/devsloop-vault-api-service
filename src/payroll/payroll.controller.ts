import {
  BadRequestException,
  Body,
  Controller,
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
  CreatePayrollPeriodDto,
  PayrollLinesQueryDto,
  UpdatePayrollLineDto,
  UpsertPayrollProfileDto,
} from './dto';
import { RequireEntity, CurrentUser, CuidValidationPipe } from 'src/common';

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
  ) {}

  @Get('periods')
  @ApiOperation({ summary: 'List payroll periods' })
  async listPeriods() {
    return this.payrollService.listPeriods();
  }

  @Post('periods')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a payroll period (YYYY-MM)' })
  async createPeriod(@Body() dto: CreatePayrollPeriodDto, @CurrentUser('id') actorId: string) {
    return this.payrollService.createPeriod(dto, actorId);
  }

  @Get('periods/:periodId')
  @ApiOperation({ summary: 'Get payroll period' })
  async getPeriod(@Param('periodId', CuidValidationPipe) periodId: string) {
    return this.payrollService.getPeriod(periodId);
  }

  @Post('periods/:periodId/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh lines from HR data and recalculate' })
  async refreshLines(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @CurrentUser('id') actorId: string,
  ) {
    return this.payrollService.refreshLines(periodId, actorId);
  }

  @Post('periods/:periodId/recalculate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recalculate all lines' })
  async recalculate(@Param('periodId', CuidValidationPipe) periodId: string) {
    await this.payrollService.recalculatePeriod(periodId);
    return { success: true as const };
  }

  @Get('periods/:periodId/lines')
  @ApiOperation({ summary: 'Paginated payroll lines with IBAN' })
  async listLines(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @Query() query: PayrollLinesQueryDto,
  ) {
    return this.payrollService.listLines(periodId, query);
  }

  @Get('periods/:periodId/users/:userId/leaves')
  @ApiOperation({ summary: 'Get HR-approved leaves for a user in a payroll period month' })
  async getApprovedLeavesForLine(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @Param('userId', CuidValidationPipe) userId: string,
  ) {
    return this.payrollService.getApprovedLeavesForLine(periodId, userId);
  }

  @Get('periods/:periodId/users/:userId/hr-claims')
  @ApiOperation({
    summary:
      'Get HR-approved salary-adjustment reimbursements for a user in a payroll period month',
  })
  async getHrClaimsForLine(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @Param('userId', CuidValidationPipe) userId: string,
  ) {
    return this.payrollService.getHrClaimsForLine(periodId, userId);
  }

  @Post('periods/:periodId/lines/:lineId/refresh')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Re-sync HR data for a single payroll line and recalculate' })
  async refreshSingleLine(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @Param('lineId', CuidValidationPipe) lineId: string,
    @CurrentUser('id') actorId: string,
  ) {
    await this.payrollService.refreshSingleLine(periodId, lineId, actorId);
  }

  @Patch('periods/:periodId/lines/:lineId')
  @ApiOperation({ summary: 'Update manual adjustments on a line' })
  async updateLine(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @Param('lineId', CuidValidationPipe) lineId: string,
    @Body() dto: UpdatePayrollLineDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.payrollService.updateLine(periodId, lineId, dto, actorId);
  }

  @Get('periods/:periodId/export-metadata')
  @ApiOperation({ summary: 'Checksum metadata: UI net sum vs exportable net sum' })
  async exportMetadata(@Param('periodId', CuidValidationPipe) periodId: string) {
    return this.payrollService.getExportMetadata(periodId);
  }

  // ── Standard CSV Export (generic) ─────────────────────────────────────────

  @Post('periods/:periodId/export-csv')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Download UTF-8 CSV (Name, IBAN, Net)' })
  async exportCsv(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @CurrentUser('id') actorId: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
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
    summary:
      'Download strict-format local bank CSV (Customer Ref, PAY, BA, Bank Code, Name, Account, Amount)',
  })
  @ApiResponse({ status: 400, description: 'Missing bank details on one or more employees' })
  async exportLocalBankCsv(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @CurrentUser('id') actorId: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
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
    summary:
      'Download formatted XLSX (Payment Summary + Full Breakdown + optional Audit Trail). Does NOT lock the period.',
  })
  async exportXlsx(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @Query('audit') auditParam: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const includeAudit = auditParam === 'true';
    const { buffer, filename, checksum } = await this.xlsxExportService.generateAdvancedXlsx(
      periodId,
      includeAudit,
    );
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
    summary:
      'Download remittance XLSX for international transfers. Requires city and province on all exportable employees.',
  })
  @ApiResponse({ status: 400, description: 'Missing geographic or bank details on employees' })
  async exportRemittanceXlsx(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @CurrentUser('id') actorId: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const result = await this.remittanceExportService.exportRemittanceXlsx(periodId, actorId);

    if (result.validationErrors.length > 0) {
      res.status(400).json({
        statusCode: 400,
        message: 'Some employees are missing fields required for remittance export',
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
    res.send(result.buffer);
  }

  // ── Lock / Unlock ─────────────────────────────────────────────────────────

  @Post('periods/:periodId/lock')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Lock a payroll period — prevents further edits' })
  async lockPeriod(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @CurrentUser('id') actorId: string,
  ): Promise<void> {
    await this.payrollService.lockPeriod(periodId, actorId);
  }

  @Post('periods/:periodId/unlock')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unlock a payroll period — re-enables edits' })
  async unlockPeriod(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @CurrentUser('id') actorId: string,
  ): Promise<void> {
    await this.payrollService.unlockPeriod(periodId, actorId);
  }

  // ── Bulk Adjustments ──────────────────────────────────────────────────────

  @Get('periods/:periodId/bulk-adjustments/template')
  @ApiOperation({ summary: 'Download CSV template for bulk adjustments' })
  async getBulkAdjustmentTemplate(
    @Param('periodId', CuidValidationPipe) _periodId: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
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
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary:
      'Upload CSV/XLSX of bulk adjustments. dryRun=true (default) previews without applying. conflictMode: OVERWRITE | ADD',
  })
  async uploadBulkAdjustments(
    @Param('periodId', CuidValidationPipe) periodId: string,
    @Query() query: BulkAdjustmentQueryDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') actorId: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
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
  @ApiOperation({ summary: 'Upsert rental/commute/consultant allowances for payroll (per user)' })
  async upsertProfile(
    @Param('userId', CuidValidationPipe) userId: string,
    @Body() dto: UpsertPayrollProfileDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.payrollService.upsertPayrollProfile(userId, dto, actorId);
  }
}
