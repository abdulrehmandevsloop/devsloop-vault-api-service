import {
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
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PayrollService } from './payroll.service';
import {
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
  constructor(private readonly payrollService: PayrollService) {}

  @Get('periods')
  @ApiOperation({ summary: 'List payroll periods' })
  @ApiResponse({ status: 200 })
  async listPeriods() {
    return this.payrollService.listPeriods();
  }

  @Post('periods')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a payroll period (YYYY-MM)' })
  @ApiResponse({ status: 201 })
  async createPeriod(@Body() dto: CreatePayrollPeriodDto, @CurrentUser('id') actorId: string) {
    return this.payrollService.createPeriod(dto, actorId);
  }

  @Get('periods/:periodId')
  @ApiOperation({ summary: 'Get payroll period' })
  @ApiResponse({ status: 200 })
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

  @Post('periods/:periodId/export-csv')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Download UTF-8 CSV and lock period (excludes HOLD, DEACTIVATED, missing IBAN)',
  })
  @ApiResponse({ status: 409, description: 'Period already locked or concurrent export' })
  @ApiResponse({ status: 429, description: 'Too many export requests' })
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

  @Patch('users/:userId/profile')
  @ApiOperation({ summary: 'Upsert rental/commute allowances for payroll (per user)' })
  async upsertProfile(
    @Param('userId', CuidValidationPipe) userId: string,
    @Body() dto: UpsertPayrollProfileDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.payrollService.upsertPayrollProfile(userId, dto, actorId);
  }
}
