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
  lunchEnabled: boolean;
  lunchDaysOverride: number | null;
  defaultLunchDays: number | null;
  incomeTaxAmount: number;
  // Consultant-specific
  consultantPayMode: string | null;
  contractedDailyRate: number;
  contractedHourlyRate: number;
  hoursWorked: number;
  /** Decimal rate applied to consultant gross (e.g. 0.04 = 4%) */
  consultantTaxRate: number;
  /** Approved salary adjustment additions for the target month (PKR) */
  salaryAdditions: number;
  /** Approved salary adjustment deductions for the target month (PKR) */
  salaryDeductions: number;
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

function countCalendarDaysInUtcMonth(_yearMonth: string): number {
  return 30;
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
    const mode = input.consultantPayMode ?? 'FIXED';
    let consultantBase = 0;

    if (mode === 'DAILY_RATE') {
      consultantBase =
        input.contractedDailyRate * (input.standardWorkingDays + input.extraWorkingDays);
    } else if (mode === 'HOURLY_RATE') {
      consultantBase = input.contractedHourlyRate * input.hoursWorked;
    } else {
      consultantBase = input.baseSalaryMonthly;
    }

    const grossSalary =
      consultantBase +
      input.rentalAllowanceMonthly +
      input.commuteAllowanceMonthly +
      input.performanceBonus +
      input.reimbursementManual +
      input.reimbursementFromHr;

    const rate = input.consultantTaxRate;
    const taxDeduction = grossSalary * rate;
    const totalDeductions =
      taxDeduction +
      input.fines +
      input.loanDeduction +
      input.advanceDeduction +
      input.salaryDeductions;

    if (input.employeeStatus === EmployeeStatus.FREEZE) {
      const denom = Math.max(input.standardWorkingDays, 1);
      const factor =
        input.pendingWorkingDays === null || input.pendingWorkingDays === undefined
          ? 1
          : Math.max(0, Math.min(1, input.pendingWorkingDays / denom));
      const scaledGross = grossSalary * factor;
      const scaledTax = scaledGross * rate;
      const scaledDeductions =
        scaledTax +
        input.fines * factor +
        input.loanDeduction * factor +
        input.advanceDeduction * factor;
      return {
        overtimeEarnings: 0,
        basicProRated: round2(consultantBase * factor),
        grossSalary: round2(scaledGross),
        foodDeduction: 0,
        taxDeduction: round2(scaledTax),
        unpaidLeaveDeduction: 0,
        totalDeductions: round2(scaledDeductions + input.salaryDeductions),
        netSalary: round2(
          scaledGross - scaledDeductions - input.salaryDeductions + input.salaryAdditions,
        ),
      };
    }

    return {
      overtimeEarnings: 0,
      basicProRated: round2(consultantBase),
      grossSalary: round2(grossSalary),
      foodDeduction: 0,
      taxDeduction: round2(taxDeduction),
      unpaidLeaveDeduction: 0,
      totalDeductions: round2(totalDeductions),
      netSalary: round2(grossSalary - totalDeductions + input.salaryAdditions),
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

    // Fixed 30 days per month — only unpaid leave and overtime use the per-day rate
    const calendarDays = countCalendarDaysInUtcMonth(yearMonth);
    const dailyBase = input.baseSalaryMonthly / calendarDays;

    const basicProRated = input.baseSalaryMonthly;
    const overtimeEarnings = dailyBase * input.extraWorkingDays;
    const unpaidLeaveDeduction = dailyBase * Math.max(0, input.unpaidLeaveDays);

    const grossSalary =
      basicProRated +
      input.rentalAllowanceMonthly +
      input.commuteAllowanceMonthly +
      input.performanceBonus +
      input.reimbursementManual +
      input.reimbursementFromHr +
      overtimeEarnings;

    const lunchDays = input.lunchDaysOverride ?? input.defaultLunchDays ?? standard;
    const foodDeduction = input.lunchEnabled ? input.lunchRatePerDay * lunchDays : 0;
    const taxDeduction = input.incomeTaxAmount;

    const totalDeductions =
      taxDeduction +
      foodDeduction +
      unpaidLeaveDeduction +
      input.fines +
      input.loanDeduction +
      input.advanceDeduction +
      input.salaryDeductions;

    if (input.employeeStatus === EmployeeStatus.FREEZE) {
      const pending = input.pendingWorkingDays;
      const denom = Math.max(standard, 1);
      const factor =
        pending === null || pending === undefined ? 1 : Math.max(0, Math.min(1, pending / denom));
      const scaledGross = grossSalary * factor;
      const scaledTax = input.incomeTaxAmount * factor;
      const scaledFood = foodDeduction * factor;
      const scaledUnpaid = unpaidLeaveDeduction * factor;
      const scaledFines = input.fines * factor;
      const scaledLoan = input.loanDeduction * factor;
      const scaledAdvance = input.advanceDeduction * factor;
      const scaledDeductions =
        scaledTax + scaledFood + scaledUnpaid + scaledFines + scaledLoan + scaledAdvance;
      return {
        overtimeEarnings: round2(overtimeEarnings * factor),
        basicProRated: round2(basicProRated * factor),
        grossSalary: round2(scaledGross),
        foodDeduction: round2(scaledFood),
        taxDeduction: round2(scaledTax),
        unpaidLeaveDeduction: round2(scaledUnpaid),
        totalDeductions: round2(scaledDeductions + input.salaryDeductions),
        netSalary: round2(
          scaledGross - scaledDeductions - input.salaryDeductions + input.salaryAdditions,
        ),
      };
    }

    return {
      overtimeEarnings: round2(overtimeEarnings),
      basicProRated: round2(basicProRated),
      grossSalary: round2(grossSalary),
      foodDeduction: round2(foodDeduction),
      taxDeduction: round2(taxDeduction),
      unpaidLeaveDeduction: round2(unpaidLeaveDeduction),
      totalDeductions: round2(totalDeductions),
      netSalary: round2(grossSalary - totalDeductions + input.salaryAdditions),
    };
  }
}
