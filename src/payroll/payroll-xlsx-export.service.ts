import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeStatus, PayrollPeriodStatus } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from 'src/prisma';

@Injectable()
export class PayrollXlsxExportService {
  constructor(private readonly prisma: PrismaService) {}

  async generateAdvancedXlsx(
    periodId: string,
    includeAudit: boolean,
  ): Promise<{ buffer: Buffer; filename: string; checksum: number }> {
    const period = await this.prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: { id: true, yearMonth: true, status: true },
    });
    if (!period) throw new NotFoundException(`Payroll period ${periodId} not found`);

    if (
      period.status !== PayrollPeriodStatus.AUTHORIZED &&
      period.status !== PayrollPeriodStatus.LOCKED
    ) {
      throw new ForbiddenException(
        'Exports are only available after the payroll period has been authorized',
      );
    }

    // Full XLSX is a complete report — include ALL active employees regardless of
    // payment method, bank details, or employee type.
    const lines = await this.prisma.payrollLine.findMany({
      where: {
        periodId,
        employeeStatus: { notIn: [EmployeeStatus.HOLD, EmployeeStatus.DEACTIVATED] },
      },
      orderBy: { displayName: 'asc' },
    });

    const userIds = lines.map((l) => l.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, iban: true, bankCode: true, accountHolderName: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'DevsLoop Vault';
    wb.created = new Date();

    // Sheet 1: Payment Summary
    const summarySheet = wb.addWorksheet('Payment Summary');
    this.applySheetStyle(summarySheet);

    summarySheet.columns = [
      { header: 'Employee Name', key: 'name', width: 28 },
      { header: 'Employee ID', key: 'empId', width: 16 },
      { header: 'Department', key: 'dept', width: 20 },
      { header: 'Designation', key: 'desig', width: 22 },
      { header: 'IBAN', key: 'iban', width: 32 },
      { header: 'Bank Code', key: 'bank', width: 16 },
      { header: 'Gross Salary', key: 'gross', width: 16 },
      { header: 'Net Salary', key: 'net', width: 16 },
      { header: 'Total Deductions', key: 'ded', width: 18 },
    ];

    this.styleHeaderRow(summarySheet);

    let checksum = 0;
    for (const line of lines) {
      const user = userMap.get(line.userId);
      const net = Number(line.netSalary);
      if (net < 0) continue;
      checksum += net;
      const ibanCell = summarySheet.addRow({
        name: line.displayName,
        empId: line.employeeCode ?? '',
        dept: (line.departments ?? []).join(', '),
        desig: line.designation ?? '',
        iban: user?.iban ?? '',
        bank: user?.bankCode ?? '',
        gross: Number(line.grossSalary),
        net,
        ded: Number(line.totalDeductions),
      });
      // Force IBAN as text
      const ibanColCell = ibanCell.getCell('iban');
      ibanColCell.numFmt = '@';
      ibanColCell.value = user?.iban ?? '';

      // Currency format
      ibanCell.getCell('gross').numFmt = '#,##0.00';
      ibanCell.getCell('net').numFmt = '#,##0.00';
      ibanCell.getCell('ded').numFmt = '#,##0.00';
    }

    summarySheet.views = [{ state: 'frozen', ySplit: 1 }];

    // Sheet 2: Full Breakdown
    const breakdownSheet = wb.addWorksheet('Full Breakdown');
    this.applySheetStyle(breakdownSheet);

    breakdownSheet.columns = [
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Emp ID', key: 'empId', width: 14 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Std Days', key: 'stdDays', width: 10 },
      { header: 'Extra Days', key: 'extraDays', width: 11 },
      { header: 'Pending Days', key: 'pendingDays', width: 13 },
      { header: 'Base Salary', key: 'base', width: 14 },
      { header: 'Basic Pro-Rated', key: 'basic', width: 16 },
      { header: 'Rental Allow.', key: 'rental', width: 14 },
      { header: 'Commute Allow.', key: 'commute', width: 15 },
      { header: 'Perf Bonus', key: 'bonus', width: 14 },
      { header: 'Reimb. Manual', key: 'reimbM', width: 15 },
      { header: 'Reimb. HR', key: 'reimbHr', width: 14 },
      { header: 'Gross Salary', key: 'gross', width: 14 },
      { header: 'Food Ded.', key: 'food', width: 12 },
      { header: 'Tax Ded.', key: 'tax', width: 12 },
      { header: 'Unpaid Leave Ded.', key: 'unpaid', width: 18 },

      { header: 'Fines', key: 'fines', width: 12 },
      { header: 'Loan Ded.', key: 'loan', width: 12 },
      { header: 'Advance Ded.', key: 'advance', width: 14 },
      { header: 'Total Deductions', key: 'totalDed', width: 16 },
      { header: 'Net Salary', key: 'net', width: 14 },
    ];

    this.styleHeaderRow(breakdownSheet);

    const moneyKeys = [
      'base',
      'basic',
      'rental',
      'commute',
      'bonus',
      'reimbM',
      'reimbHr',
      'gross',
      'food',
      'tax',
      'unpaid',
      'fines',
      'loan',
      'advance',
      'totalDed',
      'net',
    ];
    for (const line of lines) {
      const row = breakdownSheet.addRow({
        name: line.displayName,
        empId: line.employeeCode ?? '',
        status: line.employeeStatus,
        type: line.employeeType,
        stdDays: line.standardWorkingDays,
        extraDays: line.extraWorkingDays,
        pendingDays: line.pendingWorkingDays ?? '',
        base: Number(line.baseSalaryMonthly),
        basic: Number(line.basicProRated),
        rental: Number(line.rentalAllowanceMonthly),
        commute: Number(line.commuteAllowanceMonthly),
        bonus: Number(line.performanceBonus),
        reimbM: Number(line.reimbursementManual),
        reimbHr: Number(line.reimbursementFromHr),
        gross: Number(line.grossSalary),
        food: Number(line.foodDeduction),
        tax: Number(line.taxDeduction),
        unpaid: Number(line.unpaidLeaveDeduction),

        fines: Number(line.fines),
        loan: Number(line.loanDeduction),
        advance: Number(line.advanceDeduction),
        totalDed: Number(line.totalDeductions),
        net: Number(line.netSalary),
      });
      for (const key of moneyKeys) {
        row.getCell(key).numFmt = '#,##0.00';
      }
    }

    breakdownSheet.views = [{ state: 'frozen', ySplit: 1 }];

    // Sheet 3: Audit Trail (optional)
    if (includeAudit) {
      const lineIds = lines.map((l) => l.id);
      const audits = await this.prisma.payrollAdjustmentAudit.findMany({
        where: { lineId: { in: lineIds } },
        include: {
          line: { select: { displayName: true, employeeCode: true } },
          actor: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      const auditSheet = wb.addWorksheet('Audit Trail');
      this.applySheetStyle(auditSheet);
      auditSheet.columns = [
        { header: 'Timestamp', key: 'ts', width: 22 },
        { header: 'Employee', key: 'emp', width: 28 },
        { header: 'Emp ID', key: 'empId', width: 14 },
        { header: 'Field Changed', key: 'field', width: 24 },
        { header: 'Old Value', key: 'old', width: 18 },
        { header: 'New Value', key: 'new', width: 18 },
        { header: 'Changed By', key: 'actor', width: 20 },
      ];
      this.styleHeaderRow(auditSheet);

      for (const a of audits) {
        auditSheet.addRow({
          ts: a.createdAt.toISOString(),
          emp: a.line.displayName,
          empId: a.line.employeeCode ?? '',
          field: a.field,
          old: a.oldValue ?? '',
          new: a.newValue ?? '',
          actor: a.actor.name,
        });
      }
      auditSheet.views = [{ state: 'frozen', ySplit: 1 }];
    }

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return {
      buffer,
      filename: `payroll-${period.yearMonth}${includeAudit ? '-audit' : ''}.xlsx`,
      checksum: Math.round(checksum * 100) / 100,
    };
  }

  private applySheetStyle(sheet: ExcelJS.Worksheet): void {
    sheet.properties.defaultRowHeight = 18;
  }

  private styleHeaderRow(sheet: ExcelJS.Worksheet): void {
    const header = sheet.getRow(1);
    header.font = { bold: true, size: 11 };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    header.alignment = { vertical: 'middle', horizontal: 'center' };
    header.height = 22;
    header.border = {
      bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
    };
  }
}
