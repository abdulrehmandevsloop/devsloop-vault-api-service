import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AdvanceSalaryRepaymentStatus,
  AdvanceSalaryStatus,
  EmployeeStatus,
  LoanRepaymentStatus,
  LoanStatus,
  PayrollLine,
  PayrollPeriodStatus,
  ReimbursementProcessingType,
  ReimbursementStatus,
} from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from 'src/prisma';

@Injectable()
export class PayrollXlsxExportService {
  constructor(private readonly prisma: PrismaService) {}

  async generateAdvancedXlsx(
    periodId: string,
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

    const negRowFill: ExcelJS.Fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFE4E6' },
    };

    const thinBorder = {
      top: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
    } satisfies Partial<ExcelJS.Borders>;

    // ── Sheet 1: Payment Summary (all employees; negative net highlighted) ──
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
      if (net >= 0) {
        checksum += net;
      }

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

      const ibanColCell = ibanCell.getCell('iban');
      ibanColCell.numFmt = '@';
      ibanColCell.value = user?.iban ?? '';

      ibanCell.getCell('gross').numFmt = '#,##0.00';
      ibanCell.getCell('net').numFmt = '#,##0.00';
      ibanCell.getCell('ded').numFmt = '#,##0.00';

      if (net < 0) {
        ibanCell.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = negRowFill;
          cell.border = thinBorder as ExcelJS.Borders;
        });
        ibanCell.getCell('net').font = { bold: true, color: { argb: 'FFBE123C' } };
      } else {
        ibanCell.eachCell({ includeEmpty: true }, (cell) => {
          cell.border = thinBorder as ExcelJS.Borders;
        });
      }
    }

    summarySheet.views = [{ state: 'frozen', ySplit: 1 }];

    // ── Sheet 2: Full Breakdown ──
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
      const net = Number(line.netSalary);
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
        net,
      });
      for (const key of moneyKeys) {
        row.getCell(key).numFmt = '#,##0.00';
      }

      if (net < 0) {
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = negRowFill;
          cell.border = thinBorder as ExcelJS.Borders;
        });
        row.getCell('net').font = { bold: true, color: { argb: 'FFBE123C' } };
      } else {
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.border = thinBorder as ExcelJS.Borders;
        });
      }
    }

    breakdownSheet.views = [{ state: 'frozen', ySplit: 1 }];

    await this.addLineItemsDetailSheet(
      wb,
      lines,
      period.yearMonth,
      userMap,
      negRowFill,
      thinBorder as ExcelJS.Borders,
    );

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

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return {
      buffer,
      filename: `payroll-${period.yearMonth}.xlsx`,
      checksum: Math.round(checksum * 100) / 100,
    };
  }

  private async addLineItemsDetailSheet(
    wb: ExcelJS.Workbook,
    lines: PayrollLine[],
    yearMonth: string,
    userMap: Map<
      string,
      { id: string; iban: string | null; bankCode: string | null; accountHolderName: string | null }
    >,
    negRowFill: ExcelJS.Fill,
    thinBorder: ExcelJS.Borders,
  ): Promise<void> {
    const userIds = [...new Set(lines.map((l) => l.userId))];

    const directClaims = await this.prisma.reimbursementRequest.findMany({
      where: {
        employeeId: { in: userIds },
        salaryMonth: yearMonth,
        processingType: ReimbursementProcessingType.SALARY_ADJUSTMENT,
        status: { in: [ReimbursementStatus.APPROVED, ReimbursementStatus.PROCESSED] },
        hasInstallmentPlan: false,
      },
      select: {
        employeeId: true,
        id: true,
        description: true,
        reimbursementType: true,
        approvedAmount: true,
        amount: true,
        merchantName: true,
        transactionDate: true,
      },
      orderBy: { transactionDate: 'asc' },
    });

    const instClaims = await this.prisma.reimbursementInstallment.findMany({
      where: {
        scheduledMonth: yearMonth,
        reimbursement: {
          employeeId: { in: userIds },
          processingType: ReimbursementProcessingType.SALARY_ADJUSTMENT,
          status: { in: [ReimbursementStatus.APPROVED, ReimbursementStatus.PROCESSED] },
          hasInstallmentPlan: true,
        },
      },
      select: {
        id: true,
        amount: true,
        installmentNo: true,
        reimbursement: {
          select: {
            employeeId: true,
            description: true,
            reimbursementType: true,
            merchantName: true,
            transactionDate: true,
            totalInstallments: true,
          },
        },
      },
      orderBy: { reimbursement: { transactionDate: 'asc' } },
    });

    type HrEntry = {
      requestId: string;
      reimbursementType: string;
      amount: number;
      description: string;
    };

    const directByUser = new Map<string, typeof directClaims>();
    for (const c of directClaims) {
      const arr = directByUser.get(c.employeeId) ?? [];
      arr.push(c);
      directByUser.set(c.employeeId, arr);
    }
    for (const arr of directByUser.values()) {
      arr.sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime());
    }

    const instByUser = new Map<string, typeof instClaims>();
    for (const row of instClaims) {
      const uid = row.reimbursement.employeeId;
      const arr = instByUser.get(uid) ?? [];
      arr.push(row);
      instByUser.set(uid, arr);
    }
    for (const arr of instByUser.values()) {
      arr.sort(
        (a, b) =>
          a.reimbursement.transactionDate.getTime() - b.reimbursement.transactionDate.getTime(),
      );
    }

    const hrByUser = new Map<string, HrEntry[]>();
    for (const uid of userIds) {
      const list: HrEntry[] = [];
      for (const c of directByUser.get(uid) ?? []) {
        const descParts = [c.description, c.merchantName].filter(Boolean);
        list.push({
          requestId: c.id,
          reimbursementType: c.reimbursementType,
          amount: Number(c.approvedAmount ?? c.amount),
          description: this.trimMasterExportText(descParts.join(' — ')),
        });
      }
      for (const inst of instByUser.get(uid) ?? []) {
        const r = inst.reimbursement;
        const ti = r.totalInstallments;
        const suffix = ti
          ? ` (instalment ${inst.installmentNo}/${ti})`
          : ` (instalment ${inst.installmentNo})`;
        const tail = r.merchantName ? ` — ${r.merchantName}` : '';
        list.push({
          requestId: inst.id,
          reimbursementType: r.reimbursementType,
          amount: Number(inst.amount),
          description: this.trimMasterExportText(`${r.description}${suffix}${tail}`),
        });
      }
      hrByUser.set(uid, list);
    }

    const loanRepays = await this.prisma.loanRepayment.findMany({
      where: {
        scheduledMonth: yearMonth,
        status: LoanRepaymentStatus.PENDING,
        loan: {
          employeeId: { in: userIds },
          status: { in: [LoanStatus.DISBURSED, LoanStatus.REPAYING] },
        },
      },
      select: {
        id: true,
        installmentNo: true,
        amount: true,
        loan: { select: { employeeId: true, purpose: true } },
      },
      orderBy: { installmentNo: 'asc' },
    });

    const loanByUser = new Map<string, typeof loanRepays>();
    for (const r of loanRepays) {
      const uid = r.loan.employeeId;
      const arr = loanByUser.get(uid) ?? [];
      arr.push(r);
      loanByUser.set(uid, arr);
    }

    const advanceRepays = await this.prisma.advanceSalaryRepayment.findMany({
      where: {
        scheduledMonth: yearMonth,
        status: AdvanceSalaryRepaymentStatus.PENDING,
        advanceSalary: {
          employeeId: { in: userIds },
          status: { in: [AdvanceSalaryStatus.DISBURSED, AdvanceSalaryStatus.REPAYING] },
        },
      },
      select: {
        id: true,
        installmentNo: true,
        amount: true,
        advanceSalary: { select: { employeeId: true, reason: true } },
      },
      orderBy: { installmentNo: 'asc' },
    });

    const advanceByUser = new Map<string, typeof advanceRepays>();
    for (const r of advanceRepays) {
      const uid = r.advanceSalary.employeeId;
      const arr = advanceByUser.get(uid) ?? [];
      arr.push(r);
      advanceByUser.set(uid, arr);
    }

    let maxHr = 0;
    let maxLoan = 0;
    let maxAdv = 0;
    for (const line of lines) {
      maxHr = Math.max(maxHr, hrByUser.get(line.userId)?.length ?? 0);
      maxLoan = Math.max(maxLoan, loanByUser.get(line.userId)?.length ?? 0);
      maxAdv = Math.max(maxAdv, advanceByUser.get(line.userId)?.length ?? 0);
    }

    const staticHeaders: string[] = [
      'Employee Name',
      'Employee Code',
      'Departments',
      'Designation',
      'Employee Status',
      'Employee Type',
      'IBAN',
      'Bank Code',
      'Account Holder Name',
      'Pay Via Remittance',
      'Include HR Reimbursements',
      'Standard Working Days',
      'Extra Working Days',
      'Pending Working Days',
      'Paid Leave Days',
      'Unpaid Leave Days',
      'Lunch Days Override',
      'Base Salary Monthly',
      'Rental Allowance Monthly',
      'Commute Allowance Monthly',
      'Performance Bonus',
      'Reimbursement Manual',
      'Reimbursement From HR (Line Total)',
      'Sum HR Reimbursement Line Items',
      'HR Reimbursement Line Item Count',
      'Overtime Earnings',
      'Basic Pro-Rated',
      'Gross Salary',
      'Food Deduction',
      'Tax Deduction',
      'Unpaid Leave Deduction',
      'Fines Penalties',
      'Loan Deduction (Line Total)',
      'Sum Loan Repayment Line Items',
      'Loan Repayment Line Item Count',
      'Advance Deduction (Line Total)',
      'Sum Advance Repayment Line Items',
      'Advance Repayment Line Item Count',
      'Deduction Taxable',
      'Deduction Non-Taxable',
      'Tax Percent Override',
      'Total Deductions',
      'Net Salary',
      'Consultant Pay Mode',
      'Contracted Daily Rate',
      'Contracted Hourly Rate',
      'Hours Worked',
      'Line Version',
      'Calculated At',
    ];

    const dynHeaders: string[] = [];
    for (let i = 1; i <= maxHr; i++) {
      dynHeaders.push(
        `HR_Reimbursement_${i}_RequestId`,
        `HR_Reimbursement_${i}_Type`,
        `HR_Reimbursement_${i}_Amount`,
        `HR_Reimbursement_${i}_Description`,
      );
    }
    for (let i = 1; i <= maxLoan; i++) {
      dynHeaders.push(
        `Loan_Repayment_${i}_Id`,
        `Loan_Repayment_${i}_InstallmentNo`,
        `Loan_Repayment_${i}_Amount`,
        `Loan_Repayment_${i}_Purpose`,
      );
    }
    for (let i = 1; i <= maxAdv; i++) {
      dynHeaders.push(
        `Advance_Repayment_${i}_Id`,
        `Advance_Repayment_${i}_InstallmentNo`,
        `Advance_Repayment_${i}_Amount`,
        `Advance_Repayment_${i}_Reason`,
      );
    }

    const allHeaders = [...staticHeaders, ...dynHeaders];
    const netSalaryCol1Based = staticHeaders.indexOf('Net Salary') + 1;
    const ibanCol1Based = staticHeaders.indexOf('IBAN') + 1;

    const detail = wb.addWorksheet('Line Items Detail');
    this.applySheetStyle(detail);
    detail.addRow(allHeaders);
    this.styleHeaderRow(detail);

    const moneyCols1Based = this.buildMasterMoneyColumnIndexes1Based(
      staticHeaders,
      maxHr,
      maxLoan,
      maxAdv,
    );
    const installmentCols1Based = new Set<number>();
    allHeaders.forEach((h, i) => {
      if (h.includes('InstallmentNo')) {
        installmentCols1Based.add(i + 1);
      }
    });

    for (let c = 1; c <= allHeaders.length; c++) {
      detail.getColumn(c).width =
        c === ibanCol1Based ? 22 : Math.min(18, (allHeaders[c - 1]?.length ?? 8) + 2);
    }

    for (const line of lines) {
      const u = userMap.get(line.userId);
      const net = Number(line.netSalary);

      const hrList = hrByUser.get(line.userId) ?? [];
      const sumHr = hrList.reduce((acc, x) => acc + x.amount, 0);
      const loanList = loanByUser.get(line.userId) ?? [];
      const sumLoan = loanList.reduce((acc, x) => acc + Number(x.amount), 0);
      const advList = advanceByUser.get(line.userId) ?? [];
      const sumAdv = advList.reduce((acc, x) => acc + Number(x.amount), 0);

      const lunchOv = line.lunchDaysOverride;
      const pendingOv = line.pendingWorkingDays;
      const taxOv = line.taxPercentOverride;

      const rowValues: Array<string | number | boolean | null> = [
        line.displayName,
        line.employeeCode ?? '',
        (line.departments ?? []).join('; '),
        line.designation ?? '',
        line.employeeStatus,
        line.employeeType ?? '',
        u?.iban?.trim() ?? '',
        u?.bankCode ?? '',
        u?.accountHolderName ?? '',
        (line as any).paymentMode,
        line.includeHrReimbursements,
        line.standardWorkingDays,
        line.extraWorkingDays,
        pendingOv === null || pendingOv === undefined ? null : pendingOv,
        Number(line.paidLeaveDays),
        Number(line.unpaidLeaveDays),
        lunchOv === null || lunchOv === undefined ? null : lunchOv,
        Number(line.baseSalaryMonthly),
        Number(line.rentalAllowanceMonthly),
        Number(line.commuteAllowanceMonthly),
        Number(line.performanceBonus),
        Number(line.reimbursementManual),
        Number(line.reimbursementFromHr),
        sumHr,
        hrList.length,
        Number(line.overtimeEarnings),
        Number(line.basicProRated),
        Number(line.grossSalary),
        Number(line.foodDeduction),
        Number(line.taxDeduction),
        Number(line.unpaidLeaveDeduction),
        Number(line.fines),
        Number(line.loanDeduction),
        sumLoan,
        loanList.length,
        Number(line.advanceDeduction),
        sumAdv,
        advList.length,
        Number(line.deductionTaxable),
        Number(line.deductionNonTaxable),
        taxOv === null || taxOv === undefined ? null : Number(taxOv),
        Number(line.totalDeductions),
        net,
        line.consultantPayMode ?? '',
        line.contractedDailyRate === null || line.contractedDailyRate === undefined
          ? null
          : Number(line.contractedDailyRate),
        line.contractedHourlyRate === null || line.contractedHourlyRate === undefined
          ? null
          : Number(line.contractedHourlyRate),
        line.hoursWorked === null || line.hoursWorked === undefined
          ? null
          : Number(line.hoursWorked),
        line.version,
        line.calculatedAt ? line.calculatedAt.toISOString() : '',
      ];

      for (let i = 0; i < maxHr; i++) {
        const h = hrList[i];
        if (h) {
          rowValues.push(h.requestId, h.reimbursementType, h.amount, h.description);
        } else {
          rowValues.push('', '', null, '');
        }
      }
      for (let i = 0; i < maxLoan; i++) {
        const lr = loanList[i];
        if (lr) {
          rowValues.push(
            lr.id,
            lr.installmentNo,
            Number(lr.amount),
            this.trimMasterExportText(lr.loan.purpose ?? ''),
          );
        } else {
          rowValues.push('', null, null, '');
        }
      }
      for (let i = 0; i < maxAdv; i++) {
        const ar = advList[i];
        if (ar) {
          rowValues.push(
            ar.id,
            ar.installmentNo,
            Number(ar.amount),
            this.trimMasterExportText(ar.advanceSalary.reason ?? ''),
          );
        } else {
          rowValues.push('', null, null, '');
        }
      }

      const excelRow = detail.addRow(rowValues);
      excelRow.height = 18;

      excelRow.getCell(ibanCol1Based).numFmt = '@';

      for (const col1Based of moneyCols1Based) {
        const cell = excelRow.getCell(col1Based);
        if (cell.value !== null && cell.value !== '' && typeof cell.value === 'number') {
          cell.numFmt = '#,##0.00';
        }
      }

      for (const col1Based of [
        staticHeaders.indexOf('Standard Working Days') + 1,
        staticHeaders.indexOf('Extra Working Days') + 1,
        staticHeaders.indexOf('Pending Working Days') + 1,
        staticHeaders.indexOf('Lunch Days Override') + 1,
        staticHeaders.indexOf('HR Reimbursement Line Item Count') + 1,
        staticHeaders.indexOf('Loan Repayment Line Item Count') + 1,
        staticHeaders.indexOf('Advance Repayment Line Item Count') + 1,
        staticHeaders.indexOf('Line Version') + 1,
      ]) {
        const cell = excelRow.getCell(col1Based);
        if (cell.value !== null && cell.value !== '' && typeof cell.value === 'number') {
          cell.numFmt = '0';
        }
      }

      for (const col1Based of installmentCols1Based) {
        const cell = excelRow.getCell(col1Based);
        if (cell.value !== null && cell.value !== '' && typeof cell.value === 'number') {
          cell.numFmt = '0';
        }
      }

      if (net < 0) {
        excelRow.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = negRowFill;
          cell.border = thinBorder;
        });
        excelRow.getCell(netSalaryCol1Based).font = { bold: true, color: { argb: 'FFBE123C' } };
      } else {
        excelRow.eachCell({ includeEmpty: true }, (cell) => {
          cell.border = thinBorder;
        });
      }
    }

    detail.views = [{ state: 'frozen', ySplit: 1, xSplit: 0 }];
  }

  private buildMasterMoneyColumnIndexes1Based(
    staticHeaders: string[],
    maxHr: number,
    maxLoan: number,
    maxAdv: number,
  ): number[] {
    const moneyHeaderNames = new Set<string>([
      'Base Salary Monthly',
      'Rental Allowance Monthly',
      'Commute Allowance Monthly',
      'Performance Bonus',
      'Reimbursement Manual',
      'Reimbursement From HR (Line Total)',
      'Sum HR Reimbursement Line Items',
      'Overtime Earnings',
      'Basic Pro-Rated',
      'Gross Salary',
      'Food Deduction',
      'Tax Deduction',
      'Unpaid Leave Deduction',
      'Fines Penalties',
      'Loan Deduction (Line Total)',
      'Sum Loan Repayment Line Items',
      'Advance Deduction (Line Total)',
      'Sum Advance Repayment Line Items',
      'Deduction Taxable',
      'Deduction Non-Taxable',
      'Tax Percent Override',
      'Total Deductions',
      'Net Salary',
      'Contracted Daily Rate',
      'Contracted Hourly Rate',
      'Hours Worked',
      'Paid Leave Days',
      'Unpaid Leave Days',
    ]);
    const cols: number[] = [];
    staticHeaders.forEach((h, i) => {
      if (moneyHeaderNames.has(h)) {
        cols.push(i + 1);
      }
    });
    const staticLen = staticHeaders.length;
    let off = staticLen;
    for (let i = 0; i < maxHr; i++) {
      cols.push(off + i * 4 + 3);
    }
    off += maxHr * 4;
    for (let i = 0; i < maxLoan; i++) {
      cols.push(off + i * 4 + 3);
    }
    off += maxLoan * 4;
    for (let i = 0; i < maxAdv; i++) {
      cols.push(off + i * 4 + 3);
    }
    return [...new Set(cols)].sort((a, b) => a - b);
  }

  private trimMasterExportText(raw: string, maxLen = 400): string {
    const t = raw
      .replace(/\r\n/g, ' ')
      .replace(/[\n\r]/g, ' ')
      .trim();
    if (t.length <= maxLen) {
      return t;
    }
    return `${t.slice(0, maxLen - 1)}…`;
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
