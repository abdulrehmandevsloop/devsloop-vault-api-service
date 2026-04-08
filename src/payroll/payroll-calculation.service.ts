import { Injectable } from '@nestjs/common';
import { EmployeeStatus } from '@prisma/client';

export interface PayrollCalcLineInput {
  employeeStatus: EmployeeStatus;
  employeeType: string | null;
  baseSalaryMonthly: number;
  rentalAllowanceMonthly: number;
  commuteAllowanceMonthly: number;
  standardWorkingDays: number;
  extraWorkingDays: number;
  pendingWorkingDays: number | null;
  unpaidLeaveDays: number;
  performanceBonus: number;
  reimbursementManual: number;
  reimbursementFromHr: number;
  fines: number;
  loanDeduction: number;
  advanceDeduction: number;
  lunchRatePerDay: number;
  incomeTaxAmount: number;
  // Consultant-specific
  consultantPayMode: string | null;
  contractedDailyRate: number;
  contractedHourlyRate: number;
  hoursWorked: number;
}

export interface PayrollCalcLineResult {
  overtimeEarnings: number;
  basicProRated: number;
  grossSalary: number;
  foodDeduction: number;
  taxDeduction: number;
  unpaidLeaveDeduction: number;
  totalDeductions: number;
  netSalary: number;
}

export function countWeekdaysInUtcMonth(yearMonth: string): number {
  const parts = yearMonth.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return 0;
  }
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  let count = 0;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) {
      count++;
    }
  }
  return count;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class PayrollCalculationService {
  calculateLine(yearMonth: string, input: PayrollCalcLineInput): PayrollCalcLineResult {
    const zero: PayrollCalcLineResult = {
      overtimeEarnings: 0,
      basicProRated: 0,
      grossSalary: 0,
      foodDeduction: 0,
      taxDeduction: 0,
      unpaidLeaveDeduction: 0,
      totalDeductions: 0,
      netSalary: 0,
    };

    if (input.employeeStatus === EmployeeStatus.DEACTIVATED) {
      return zero;
    }

    // ── Consultant branch ──────────────────────────────────────────────────────
    if (input.employeeType === 'CONSULTANT') {
      return this.calculateConsultantLine(yearMonth, input);
    }

    // ── Standard employee branch ───────────────────────────────────────────────
    return this.calculateEmployeeLine(yearMonth, input);
  }

  private calculateConsultantLine(
    _yearMonth: string,
    input: PayrollCalcLineInput,
  ): PayrollCalcLineResult {
    // Gross depends on pay mode
    let consultantBase = 0;
    const mode = input.consultantPayMode ?? 'FIXED';

    if (mode === 'DAILY_RATE') {
      const daysWorked = input.standardWorkingDays + input.extraWorkingDays;
      consultantBase = round2(input.contractedDailyRate * daysWorked);
    } else if (mode === 'HOURLY_RATE') {
      consultantBase = round2(input.contractedHourlyRate * input.hoursWorked);
    } else {
      // FIXED — retainer / project fee stored as baseSalaryMonthly
      consultantBase = round2(input.baseSalaryMonthly);
    }

    const grossSalary = round2(
      consultantBase +
        input.performanceBonus +
        input.reimbursementManual +
        input.reimbursementFromHr,
    );

    // No lunch deduction for consultants
    const foodDeduction = 0;

    // Fixed 4% tax on gross for all consultants
    const taxDeduction = round2(grossSalary * 0.04);

    // Only explicit deductions apply (no unpaid leave, no food)
    const totalDeductions = round2(
      taxDeduction + input.fines + input.loanDeduction + input.advanceDeduction,
    );

    if (input.employeeStatus === EmployeeStatus.FREEZE) {
      const denom = Math.max(input.standardWorkingDays, 1);
      const factor =
        input.pendingWorkingDays === null || input.pendingWorkingDays === undefined
          ? 1
          : Math.max(0, Math.min(1, input.pendingWorkingDays / denom));
      const scaledGross = round2(grossSalary * factor);
      const scaledTax = round2(scaledGross * 0.04);
      const scaledFines = round2(input.fines * factor);
      const scaledLoan = round2(input.loanDeduction * factor);
      const scaledAdvance = round2(input.advanceDeduction * factor);
      const scaledDeductions = round2(scaledTax + scaledFines + scaledLoan + scaledAdvance);
      return {
        overtimeEarnings: 0,
        basicProRated: round2(consultantBase * factor),
        grossSalary: scaledGross,
        foodDeduction: 0,
        taxDeduction: scaledTax,
        unpaidLeaveDeduction: 0,
        totalDeductions: scaledDeductions,
        netSalary: round2(scaledGross - scaledDeductions),
      };
    }

    return {
      overtimeEarnings: 0,
      basicProRated: consultantBase,
      grossSalary,
      foodDeduction,
      taxDeduction,
      unpaidLeaveDeduction: 0,
      totalDeductions,
      netSalary: round2(grossSalary - totalDeductions),
    };
  }

  private calculateEmployeeLine(
    yearMonth: string,
    input: PayrollCalcLineInput,
  ): PayrollCalcLineResult {
    const standard =
      input.standardWorkingDays > 0
        ? input.standardWorkingDays
        : countWeekdaysInUtcMonth(yearMonth);

    const dailyBase = input.baseSalaryMonthly / 30;
    const basicProRated = round2(dailyBase * standard);
    const overtimeEarnings = round2(dailyBase * input.extraWorkingDays);

    const paidDays = standard + input.extraWorkingDays;
    const rentalProRated = round2((input.rentalAllowanceMonthly / 30) * paidDays);
    const commuteProRated = round2((input.commuteAllowanceMonthly / 30) * paidDays);

    let grossSalary = round2(
      basicProRated +
        rentalProRated +
        commuteProRated +
        input.performanceBonus +
        input.reimbursementManual +
        input.reimbursementFromHr +
        overtimeEarnings,
    );

    const foodDeduction = round2(input.lunchRatePerDay * paidDays);
    const unpaidLeaveDeduction = round2(dailyBase * Math.max(0, input.unpaidLeaveDays));
    let taxDeduction = round2(input.incomeTaxAmount);

    let totalDeductions = round2(
      taxDeduction +
        foodDeduction +
        unpaidLeaveDeduction +
        input.fines +
        input.loanDeduction +
        input.advanceDeduction,
    );

    let netSalary = round2(grossSalary - totalDeductions);

    if (input.employeeStatus === EmployeeStatus.FREEZE) {
      const pending = input.pendingWorkingDays;
      const denom = Math.max(standard, 1);
      const factor =
        pending === null || pending === undefined ? 1 : Math.max(0, Math.min(1, pending / denom));
      grossSalary = round2(grossSalary * factor);
      taxDeduction = round2(input.incomeTaxAmount * factor);
      const scaledFood = round2(foodDeduction * factor);
      const scaledUnpaidLeave = round2(unpaidLeaveDeduction * factor);
      const scaledFines = round2(input.fines * factor);
      const scaledLoan = round2(input.loanDeduction * factor);
      const scaledAdvance = round2(input.advanceDeduction * factor);
      totalDeductions = round2(
        taxDeduction + scaledFood + scaledUnpaidLeave + scaledFines + scaledLoan + scaledAdvance,
      );
      netSalary = round2(grossSalary - totalDeductions);
      return {
        overtimeEarnings: round2(overtimeEarnings * factor),
        basicProRated: round2(basicProRated * factor),
        grossSalary,
        foodDeduction: scaledFood,
        taxDeduction,
        unpaidLeaveDeduction: scaledUnpaidLeave,
        totalDeductions,
        netSalary,
      };
    }

    return {
      overtimeEarnings,
      basicProRated,
      grossSalary,
      foodDeduction,
      taxDeduction,
      unpaidLeaveDeduction,
      totalDeductions,
      netSalary,
    };
  }
}
