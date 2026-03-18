import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { parse as parseCsv } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../prisma';
import {
  LeaveBalanceBulkImportResultDto,
  LeaveBalanceBulkImportRowResultDto,
} from '../dto/leave-balance-bulk-import-result.dto';

interface RawLeaveBalanceRow {
  email?: string;
  year?: string;
  casual_leave?: string;
  sick_leave?: string;
  wfh_per_month?: string;
  used_casual_leave?: string;
  used_sick_leave?: string;
  used_wfh?: string;
}

@Injectable()
export class LeaveBalanceBulkImportService {
  private readonly logger = new Logger(LeaveBalanceBulkImportService.name);

  constructor(private readonly prisma: PrismaService) {}

  async importFromBuffer(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
    skipExisting = false,
  ): Promise<LeaveBalanceBulkImportResultDto> {
    const rows = this.parseFile(buffer, mimeType, originalName);

    if (rows.length === 0) {
      throw new BadRequestException('The file contains no data rows');
    }

    if (rows.length > 500) {
      throw new BadRequestException('Maximum 500 rows allowed per import');
    }

    const results: LeaveBalanceBulkImportRowResultDto[] = [];
    let succeeded = 0;
    let skipped = 0;
    let failed = 0;
    const seenKeys = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const rowResult = await this.processRow(rows[i], i + 1, skipExisting, seenKeys);
      results.push(rowResult);
      if (rowResult.skipped) skipped++;
      else if (rowResult.success) succeeded++;
      else failed++;
    }

    return { total: rows.length, succeeded, skipped, failed, results };
  }

  static buildTemplateCsvContent(): string {
    const headers = [
      'email',
      'year',
      'casual_leave',
      'sick_leave',
      'wfh_per_month',
      'used_casual_leave',
      'used_sick_leave',
      'used_wfh',
    ].join(',');
    const example = ['gulnaz.ahmed@devslooptech.com', '2026', '15', '5', '1', '3', '1', '1'].join(
      ',',
    );
    return `${headers}\n${example}\n`;
  }

  private parseFile(buffer: Buffer, mimeType: string, originalName: string): RawLeaveBalanceRow[] {
    const ext = originalName.split('.').pop()?.toLowerCase();
    const isExcel =
      ext === 'xlsx' ||
      ext === 'xls' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.ms-excel';

    if (isExcel) {
      return this.parseExcel(buffer);
    }

    try {
      return parseCsv<RawLeaveBalanceRow>(buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      });
    } catch (err) {
      throw new BadRequestException(`Failed to parse CSV file: ${(err as Error).message}`);
    }
  }

  private parseExcel(buffer: Buffer): RawLeaveBalanceRow[] {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error('No sheets found');
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      return rows.map((r) => {
        const normalized: Record<string, string> = {};
        for (const [k, v] of Object.entries(r)) {
          const key = k.trim().toLowerCase().replace(/\s+/g, '_');
          if (v === null || v === undefined || v === '') {
            normalized[key] = '';
          } else if (typeof v === 'string') {
            normalized[key] = v.trim();
          } else if (typeof v === 'number' || typeof v === 'boolean') {
            normalized[key] = String(v);
          } else if (v instanceof Date) {
            normalized[key] = v.toISOString();
          } else {
            normalized[key] = '';
          }
        }
        return normalized as RawLeaveBalanceRow;
      });
    } catch (err) {
      throw new BadRequestException(`Failed to parse Excel file: ${(err as Error).message}`);
    }
  }

  private async processRow(
    raw: RawLeaveBalanceRow,
    rowNum: number,
    skipExisting: boolean,
    seenKeys: Set<string>,
  ): Promise<LeaveBalanceBulkImportRowResultDto> {
    const email = raw.email?.trim().toLowerCase() ?? '';
    const yearRaw = raw.year?.trim() ?? '';
    const identifier = email && yearRaw ? `${email} / ${yearRaw}` : `row ${rowNum}`;

    const errors: string[] = [];

    // Required fields
    if (!email) errors.push('email is required');
    if (!yearRaw) errors.push('year is required');

    if (errors.length > 0) {
      return { row: rowNum, identifier, success: false, errors };
    }

    // Email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('email is not a valid email address');
    }

    // Year validation
    const year = parseInt(yearRaw, 10);
    const currentYear = new Date().getFullYear();
    if (isNaN(year) || year < 2020 || year > currentYear + 1) {
      errors.push(`year must be a valid calendar year between 2020 and ${currentYear + 1}`);
    }

    // Optional numeric fields
    const casualLeave = this.parseNonNegativeDecimal(raw.casual_leave, 'casual_leave', errors, 0);
    const sickLeave = this.parseNonNegativeDecimal(raw.sick_leave, 'sick_leave', errors, 0);
    const wfhPerMonth = this.parseNonNegativeInt(raw.wfh_per_month, 'wfh_per_month', errors, 1);
    // Annual leave quota is derived: casual + sick
    const annualLeave = Math.round((casualLeave + sickLeave) * 10) / 10;
    const usedCasual = this.parseNonNegativeDecimal(
      raw.used_casual_leave,
      'used_casual_leave',
      errors,
      0,
    );
    const usedSick = this.parseNonNegativeDecimal(
      raw.used_sick_leave,
      'used_sick_leave',
      errors,
      0,
    );
    if (errors.length > 0) {
      return { row: rowNum, identifier, success: false, errors };
    }

    // Duplicate within file
    const key = `${email}::${year}`;
    if (seenKeys.has(key)) {
      return {
        row: rowNum,
        identifier,
        success: false,
        errors: ['Duplicate (email, year) pair within this import file'],
      };
    }
    seenKeys.add(key);

    // User lookup
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) {
      return {
        row: rowNum,
        identifier,
        success: false,
        errors: [`Employee with email "${email}" not found`],
      };
    }

    // Skip existing check
    if (skipExisting) {
      const existing = await this.prisma.leaveBalance.findUnique({
        where: { userId_year: { userId: user.id, year } },
        select: { id: true },
      });
      if (existing) {
        return { row: rowNum, identifier, success: true, skipped: true };
      }
    }

    // Update User-level quota settings and upsert LeaveBalance in one transaction
    try {
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: user.id },
          data: {
            casualLeaveBalance: casualLeave,
            sickLeaveBalance: sickLeave,
            annualLeaveBalance: annualLeave,
            wfhAllowancePerMonth: wfhPerMonth,
          },
        }),
        this.prisma.leaveBalance.upsert({
          where: { userId_year: { userId: user.id, year } },
          create: {
            userId: user.id,
            year,
            casualBalance: casualLeave,
            sickBalance: sickLeave,
            casualUsed: usedCasual,
            sickUsed: usedSick,
          },
          update: {
            casualBalance: casualLeave,
            sickBalance: sickLeave,
            casualUsed: usedCasual,
            sickUsed: usedSick,
          },
        }),
      ]);

      this.logger.log(`Leave balance upserted for ${email} year ${year}`);
      return { row: rowNum, identifier, success: true };
    } catch (err) {
      this.logger.error(`Failed to upsert leave balance row ${rowNum}: ${(err as Error).message}`);
      return {
        row: rowNum,
        identifier,
        success: false,
        errors: ['Database error — please try again'],
      };
    }
  }

  private parseNonNegativeDecimal(
    val: string | undefined,
    field: string,
    errors: string[],
    defaultVal: number,
  ): number {
    if (!val || val.trim() === '') return defaultVal;
    const num = parseFloat(val.trim());
    if (isNaN(num) || num < 0) {
      errors.push(`${field} must be a non-negative number`);
      return defaultVal;
    }
    return Math.round(num * 10) / 10; // 1 decimal place
  }

  private parseNonNegativeInt(
    val: string | undefined,
    field: string,
    errors: string[],
    defaultVal: number,
  ): number {
    if (!val || val.trim() === '') return defaultVal;
    const num = parseInt(val.trim(), 10);
    if (isNaN(num) || num < 0) {
      errors.push(`${field} must be a non-negative integer`);
      return defaultVal;
    }
    return num;
  }
}
