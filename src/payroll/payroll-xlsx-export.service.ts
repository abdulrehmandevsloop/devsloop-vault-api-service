import { Injectable, NotFoundException } from '@nestjs/common';
import { PayrollLine } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from 'src/prisma';

/** Sequential layout phases the Master Payroll Sheet renders left-to-right. */
type Phase = 1 | 2 | 3 | 4 | 5;

interface MasterColumn {
  header: string;
  phase: Phase;
  /** Numeric columns are right-aligned, money-formatted, and summed in the Totals row. */
  numeric: boolean;
  width: number;
  get: (line: PayrollLine) => string | number;
}

// Prisma Decimal, number, or nullish — all of which Number() coerces correctly.
const num = (v: unknown): number => Number(v ?? 0);

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Operational payment status derived from the line — drives the trailing meta column. */
function paymentStatus(line: PayrollLine): string {
  switch (line.employeeStatus) {
    case 'DEACTIVATED':
      return 'Disabled';
    case 'HOLD':
      return 'On Hold';
    case 'FREEZE':
      return 'Frozen';
    default:
      break;
  }
  const net = num(line.netSalary);
  if (net < 0) return 'Negative — review';
  if (net === 0) return 'Zero';
  return 'Payable';
}

function remarks(line: PayrollLine): string {
  const parts: string[] = [];
  if (line.employeeStatus === 'HOLD' || line.employeeStatus === 'DEACTIVATED') {
    parts.push('Excluded from bank transfer — reference only');
  }
  if (num(line.netSalary) < 0) parts.push('Negative net');
  return parts.join('; ');
}

/**
 * Master Payroll Sheet export (flexible, format-driven).
 *
 * Builds a single worksheet whose columns flow through five sequential phases —
 * Identity Meta → Earnings → Gross → Deductions → Net + trailing meta — sourced
 * from the salary components the payroll engine already calculates on each line
 * (the same ones shown in the UI breakdown). Every employee row prints a value
 * (0 where a component is unused) so column alignment is identical across rows,
 * and the final row appends a per-column Sum Total as a financial checkpoint.
 *
 * All employees are exported regardless of status (Active / Hold / Frozen /
 * Disabled) so accounting can reference past-due obligations before locking.
 */
@Injectable()
export class PayrollXlsxExportService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ordered column blueprint. Each phase is contiguous and rendered in order. */
  private readonly columns: MasterColumn[] = [
    // ── Phase 1: Identity Meta ──
    {
      header: 'Employee ID',
      phase: 1,
      numeric: false,
      width: 16,
      get: (l) => l.employeeCode ?? '',
    },
    { header: 'Beneficiary Name', phase: 1, numeric: false, width: 28, get: (l) => l.displayName },
    {
      header: 'Employment Type',
      phase: 1,
      numeric: false,
      width: 16,
      get: (l) => l.employeeType ?? '',
    },
    { header: 'Status', phase: 1, numeric: false, width: 13, get: (l) => l.employeeStatus },

    // ── Phase 2: Earnings & Additions ──
    {
      header: 'Basic Salary',
      phase: 2,
      numeric: true,
      width: 15,
      get: (l) => num(l.basicProRated),
    },
    {
      header: 'Overtime / Extra Days',
      phase: 2,
      numeric: true,
      width: 16,
      get: (l) => num(l.overtimeEarnings),
    },
    {
      header: 'Rental Allowance',
      phase: 2,
      numeric: true,
      width: 15,
      get: (l) => num(l.rentalAllowanceMonthly),
    },
    {
      header: 'Commute Allowance',
      phase: 2,
      numeric: true,
      width: 16,
      get: (l) => num(l.commuteAllowanceMonthly),
    },
    {
      header: 'HR Reimbursements',
      phase: 2,
      numeric: true,
      width: 16,
      get: (l) => num(l.reimbursementFromHr),
    },
    {
      header: 'Manual Reimbursement',
      phase: 2,
      numeric: true,
      width: 17,
      get: (l) => num(l.reimbursementManual),
    },
    {
      header: 'Performance Bonus',
      phase: 2,
      numeric: true,
      width: 16,
      get: (l) => num(l.performanceBonus),
    },
    {
      header: 'Salary Additions',
      phase: 2,
      numeric: true,
      width: 15,
      get: (l) => num(l.salaryAdditions),
    },

    // ── Phase 3: The Gross Bridge ──
    { header: 'Gross Salary', phase: 3, numeric: true, width: 16, get: (l) => num(l.grossSalary) },

    // ── Phase 4: Deductions ──
    { header: 'Income Tax', phase: 4, numeric: true, width: 14, get: (l) => num(l.taxDeduction) },
    {
      header: 'Food / Lunch',
      phase: 4,
      numeric: true,
      width: 13,
      get: (l) => num(l.foodDeduction),
    },
    {
      header: 'Unpaid Leave',
      phase: 4,
      numeric: true,
      width: 14,
      get: (l) => num(l.unpaidLeaveDeduction),
    },
    { header: 'Fines / Penalties', phase: 4, numeric: true, width: 15, get: (l) => num(l.fines) },
    {
      header: 'Loan Deduction',
      phase: 4,
      numeric: true,
      width: 15,
      get: (l) => num(l.loanDeduction),
    },
    {
      header: 'Advance Salary',
      phase: 4,
      numeric: true,
      width: 15,
      get: (l) => num(l.advanceDeduction),
    },
    {
      header: 'Taxable Deduction',
      phase: 4,
      numeric: true,
      width: 16,
      get: (l) => num(l.deductionTaxable),
    },
    {
      header: 'Non-Taxable Deduction',
      phase: 4,
      numeric: true,
      width: 18,
      get: (l) => num(l.deductionNonTaxable),
    },
    {
      header: 'Salary Deductions',
      phase: 4,
      numeric: true,
      width: 16,
      get: (l) => num(l.salaryDeductions),
    },
    {
      header: 'Total Deductions',
      phase: 4,
      numeric: true,
      width: 16,
      get: (l) => num(l.totalDeductions),
    },

    // ── Phase 5: The Net Bridge & Trailing Meta ──
    { header: 'Net Salary', phase: 5, numeric: true, width: 16, get: (l) => num(l.netSalary) },
    {
      header: 'Payment Type',
      phase: 5,
      numeric: false,
      width: 16,
      get: (l) => (l as { paymentMode: string }).paymentMode,
    },
    { header: 'Payment Status', phase: 5, numeric: false, width: 16, get: paymentStatus },
    { header: 'Remarks', phase: 5, numeric: false, width: 38, get: remarks },
  ];

  // Header tint per phase — keeps the five lifecycle phases visually grouped.
  private readonly phaseFill: Record<Phase, string> = {
    1: 'FF334155', // slate (identity)
    2: 'FF047857', // emerald (earnings)
    3: 'FF0F766E', // teal (gross bridge)
    4: 'FFB91C1C', // red (deductions)
    5: 'FF1D4ED8', // blue (net + meta)
  };

  /**
   * Generate the Master Payroll workbook. Keeps the historical
   * `{ buffer, filename, checksum }` signature; `checksum` is the sum of
   * positive net salaries (informational — the master sheet does not lock).
   */
  async generateAdvancedXlsx(
    periodId: string,
  ): Promise<{ buffer: Buffer; filename: string; checksum: number }> {
    const period = await this.prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: { id: true, yearMonth: true },
    });
    if (!period) throw new NotFoundException(`Payroll period ${periodId} not found`);

    // Status Visibility: export EVERY employee line — Active, Hold, Frozen and
    // Disabled alike — so accounting can reconcile past-due obligations.
    const lines = await this.prisma.payrollLine.findMany({
      where: { periodId },
      orderBy: { displayName: 'asc' },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'DevsLoop Vault';
    wb.created = new Date();
    const sheet = wb.addWorksheet('Master Payroll');
    sheet.properties.defaultRowHeight = 18;

    const thinBorder = {
      top: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
    } satisfies Partial<ExcelJS.Borders>;

    // ── Header row ──
    const headerRow = sheet.addRow(this.columns.map((c) => c.header));
    headerRow.height = 24;
    this.columns.forEach((col, i) => {
      sheet.getColumn(i + 1).width = col.width;
      const cell = headerRow.getCell(i + 1);
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: this.phaseFill[col.phase] },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = thinBorder as ExcelJS.Borders;
    });

    // ── Data rows ──
    let checksum = 0;
    for (const line of lines) {
      const net = num(line.netSalary);
      if (net > 0) checksum += net;

      const row = sheet.addRow(this.columns.map((c) => c.get(line)));
      this.columns.forEach((col, i) => {
        const cell = row.getCell(i + 1);
        cell.border = thinBorder as ExcelJS.Borders;
        if (col.numeric) {
          cell.numFmt = '#,##0.00';
          cell.alignment = { horizontal: 'right' };
        }
      });
      if (net < 0) {
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE4E6' } };
        });
      }
    }

    // ── Bottom Summary Totals row ──
    const totals = this.columns.map((col, i) => {
      if (i === 0) return 'Total'; // first identity column literally reads "Total"
      if (!col.numeric) return ''; // non-numeric cells stay empty
      return round2(lines.reduce((sum, l) => sum + Number(col.get(l)), 0));
    });
    const totalRow = sheet.addRow(totals);
    totalRow.height = 22;
    this.columns.forEach((col, i) => {
      const cell = totalRow.getCell(i + 1);
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF475569' } },
        bottom: { style: 'medium', color: { argb: 'FF475569' } },
        left: thinBorder.left,
        right: thinBorder.right,
      } as ExcelJS.Borders;
      if (col.numeric) {
        cell.numFmt = '#,##0.00';
        cell.alignment = { horizontal: 'right' };
      }
    });

    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: this.columns.length },
    };

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return {
      buffer,
      filename: `master-payroll-${period.yearMonth}.xlsx`,
      checksum: round2(checksum),
    };
  }
}
