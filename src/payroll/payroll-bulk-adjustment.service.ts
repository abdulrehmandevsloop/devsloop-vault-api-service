import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PayrollPeriodStatus, Prisma } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { PrismaService } from 'src/prisma';
import { PayrollService } from './payroll.service';
import { BulkConflictMode } from './dto/bulk-adjustment-query.dto';
import type {
  BulkAdjustmentResult,
  BulkAdjustmentRowResult,
} from './dto/bulk-adjustment-result.dto';

interface ParsedRow {
  employee_id: string;
  bonus_amount?: string;
  deduction_amount?: string;
  extra_working_days?: string;
}

type PeriodForCalc = {
  id: string;
  yearMonth: string;
  lunchRatePerDay: Prisma.Decimal;
};

@Injectable()
export class PayrollBulkAdjustmentService {
  private readonly logger = new Logger(PayrollBulkAdjustmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payrollService: PayrollService,
  ) {}

  async processFile(
    buffer: Buffer,
    mimeType: string,
    periodId: string,
    actorId: string,
    dryRun: boolean,
    conflictMode: BulkConflictMode,
  ): Promise<BulkAdjustmentResult> {
    const period = await this.prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: {
        id: true,
        status: true,
        yearMonth: true,
        lunchRatePerDay: true,
      },
    });
    if (!period) throw new NotFoundException(`Payroll period ${periodId} not found`);
    if (period.status === PayrollPeriodStatus.LOCKED) {
      throw new BadRequestException('This payroll period is locked');
    }

    const rows = this.parseFile(buffer, mimeType);
    if (rows.length === 0) throw new BadRequestException('File contains no data rows');
    if (rows.length > 5000) throw new BadRequestException('File exceeds 5000 row limit');

    const results: BulkAdjustmentRowResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      results.push(await this.validateRow(rows[i], i + 2, periodId));
    }

    const validRows = results.filter((r) => r.valid);

    if (!dryRun && validRows.length > 0) {
      await this.applyRows(validRows, periodId, actorId, conflictMode, period);
    }

    return {
      total: results.length,
      valid: validRows.length,
      invalid: results.filter((r) => !r.valid).length,
      applied: !dryRun && validRows.length > 0,
      rows: results,
    };
  }

  generateTemplate(): string {
    return 'employee_id,bonus_amount,deduction_amount,extra_working_days\nEMP001,5000,0,\n';
  }

  private parseFile(buffer: Buffer, mimeType: string): ParsedRow[] {
    const isExcel =
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.ms-excel';
    return isExcel ? this.parseExcel(buffer) : this.parseCsv(buffer);
  }

  private parseCsv(buffer: Buffer): ParsedRow[] {
    const records: unknown[] = parse(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
    return records.map((r) => {
      if (typeof r !== 'object' || r === null) {
        throw new BadRequestException('Invalid CSV row');
      }
      const stringified: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) {
        stringified[k] = typeof v === 'string' ? v : String(v ?? '');
      }
      return this.normalizeRow(stringified);
    });
  }

  private parseExcel(buffer: Buffer): ParsedRow[] {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new BadRequestException('Excel file has no sheets');
    const sheet = wb.Sheets[sheetName];
    if (!sheet) throw new BadRequestException('Excel sheet is empty');
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, string | number>>(sheet);
    return jsonRows.map((r) => {
      const stringified: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) {
        stringified[k] = String(v ?? '');
      }
      return this.normalizeRow(stringified);
    });
  }

  private normalizeRow(r: Record<string, string>): ParsedRow {
    const get = (key: string) =>
      (r[key] ?? r[key.toLowerCase()] ?? r[key.toUpperCase()])?.trim() || undefined;
    return {
      employee_id: get('employee_id') ?? '',
      bonus_amount: get('bonus_amount'),
      deduction_amount: get('deduction_amount'),
      extra_working_days: get('extra_working_days'),
    };
  }

  private async validateRow(
    raw: ParsedRow,
    rowNumber: number,
    periodId: string,
  ): Promise<BulkAdjustmentRowResult> {
    const errors: string[] = [];
    const employeeId = raw.employee_id.trim();

    if (!employeeId) {
      errors.push('employee_id is required');
      return this.emptyResult(rowNumber, employeeId, errors);
    }

    const user = await this.prisma.user.findFirst({
      where: { employeeId },
      select: { id: true, name: true },
    });

    if (!user) {
      errors.push(`Employee "${employeeId}" not found`);
      return this.emptyResult(rowNumber, employeeId, errors);
    }

    const line = await this.prisma.payrollLine.findFirst({
      where: { periodId, userId: user.id },
      select: { performanceBonus: true, fines: true, extraWorkingDays: true },
    });

    if (!line) {
      errors.push(`No payroll line for "${employeeId}" in this period`);
      return this.emptyResult(rowNumber, employeeId, errors, user.name);
    }

    let bonus: number | null = null;
    let deduction: number | null = null;
    let extraDays: number | null = null;

    if (raw.bonus_amount !== undefined) {
      const v = parseFloat(raw.bonus_amount);
      if (Number.isNaN(v) || v < 0) errors.push(`Invalid bonus_amount: "${raw.bonus_amount}"`);
      else bonus = v;
    }

    if (raw.deduction_amount !== undefined) {
      const v = parseFloat(raw.deduction_amount);
      if (Number.isNaN(v) || v < 0)
        errors.push(`Invalid deduction_amount: "${raw.deduction_amount}"`);
      else deduction = v;
    }

    if (raw.extra_working_days !== undefined) {
      const v = parseInt(raw.extra_working_days, 10);
      if (Number.isNaN(v) || v < 0 || v > 31)
        errors.push(`Invalid extra_working_days: "${raw.extra_working_days}"`);
      else extraDays = v;
    }

    if (bonus === null && deduction === null && extraDays === null) {
      errors.push(
        'At least one value column (bonus_amount, deduction_amount, extra_working_days) is required',
      );
    }

    return {
      row: rowNumber,
      employeeId,
      name: user.name,
      bonus,
      deduction,
      extraWorkingDays: extraDays,
      currentBonus: Number(line.performanceBonus),
      currentDeduction: Number(line.fines),
      currentExtraWorkingDays: line.extraWorkingDays,
      errors,
      valid: errors.length === 0,
    };
  }

  private emptyResult(
    row: number,
    employeeId: string,
    errors: string[],
    name: string | null = null,
  ): BulkAdjustmentRowResult {
    return {
      row,
      employeeId,
      name,
      bonus: null,
      deduction: null,
      extraWorkingDays: null,
      currentBonus: 0,
      currentDeduction: 0,
      currentExtraWorkingDays: 0,
      errors,
      valid: false,
    };
  }

  private async applyRows(
    validRows: BulkAdjustmentRowResult[],
    periodId: string,
    actorId: string,
    conflictMode: BulkConflictMode,
    period: PeriodForCalc,
  ): Promise<void> {
    const lineUpdates: Prisma.PrismaPromise<unknown>[] = [];
    const audits: Prisma.PayrollAdjustmentAuditCreateManyInput[] = [];
    const lineIdsToRecalc: string[] = [];

    for (const row of validRows) {
      const user = await this.prisma.user.findFirst({
        where: { employeeId: row.employeeId },
        select: { id: true },
      });
      if (!user) continue;

      const line = await this.prisma.payrollLine.findFirst({
        where: { periodId, userId: user.id },
        select: { id: true, performanceBonus: true, fines: true, extraWorkingDays: true },
      });
      if (!line) continue;

      const data: Prisma.PayrollLineUpdateInput = {};

      if (row.bonus !== null) {
        const newVal =
          conflictMode === BulkConflictMode.ADD
            ? Number(line.performanceBonus) + row.bonus
            : row.bonus;
        audits.push({
          lineId: line.id,
          field: 'performanceBonus',
          oldValue: String(line.performanceBonus),
          newValue: String(newVal),
          actorId,
        });
        data.performanceBonus = new Prisma.Decimal(newVal);
      }

      if (row.deduction !== null) {
        const newVal =
          conflictMode === BulkConflictMode.ADD
            ? Number(line.fines) + row.deduction
            : row.deduction;
        audits.push({
          lineId: line.id,
          field: 'fines',
          oldValue: String(line.fines),
          newValue: String(newVal),
          actorId,
        });
        data.fines = new Prisma.Decimal(newVal);
      }

      if (row.extraWorkingDays !== null) {
        const newVal =
          conflictMode === BulkConflictMode.ADD
            ? line.extraWorkingDays + row.extraWorkingDays
            : row.extraWorkingDays;
        audits.push({
          lineId: line.id,
          field: 'extraWorkingDays',
          oldValue: String(line.extraWorkingDays),
          newValue: String(newVal),
          actorId,
        });
        data.extraWorkingDays = newVal;
      }

      if (Object.keys(data).length > 0) {
        lineUpdates.push(this.prisma.payrollLine.update({ where: { id: line.id }, data }));
        lineIdsToRecalc.push(line.id);
      }
    }

    if (lineUpdates.length === 0) return;

    await this.prisma.$transaction([
      ...lineUpdates,
      ...(audits.length > 0
        ? [this.prisma.payrollAdjustmentAudit.createMany({ data: audits })]
        : []),
    ]);

    this.logger.log(
      `Bulk adjustment: ${lineIdsToRecalc.length} lines updated in period ${periodId} by ${actorId}`,
    );

    for (const lineId of lineIdsToRecalc) {
      await this.payrollService.recalculateLineById(lineId, period);
    }
  }
}
