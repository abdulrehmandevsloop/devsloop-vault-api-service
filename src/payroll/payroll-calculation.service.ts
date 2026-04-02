import { Injectable } from '@nestjs/common';
import { EmployeeStatus } from '@prisma/client';

export interface PayrollCalcLineInput {
  employeeStatus: EmployeeStatus;
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
  deductionTaxable: number;
  deductionNonTaxable: number;
  fines: number;
  loanDeduction: number;
  advanceDeduction: number;
  lunchRatePerDay: number;
  defaultTaxPercent: number;
  taxPercentOverride: number | null;
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
    const standard =
      input.standardWorkingDays > 0
        ? input.standardWorkingDays
        : countWeekdaysInUtcMonth(yearMonth);

    const deactivated: PayrollCalcLineResult = {
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
      return deactivated;
    }

    const dailyBase = input.baseSalaryMonthly / 30;
    const basicProRated = round2(dailyBase * standard);
    const overtimeEarnings = round2(dailyBase * input.extraWorkingDays);

    const paidDays = standard + input.extraWorkingDays;
    const rentalDaily = input.rentalAllowanceMonthly / 30;
    const commuteDaily = input.commuteAllowanceMonthly / 30;
    const rentalProRated = round2(rentalDaily * paidDays);
    const commuteProRated = round2(commuteDaily * paidDays);

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
    const taxPercent = input.taxPercentOverride ?? input.defaultTaxPercent;
    let taxDeduction = round2((grossSalary * taxPercent) / 100);

    let totalDeductions = round2(
      taxDeduction +
        foodDeduction +
        unpaidLeaveDeduction +
        input.fines +
        input.deductionTaxable +
        input.deductionNonTaxable +
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
      taxDeduction = round2((grossSalary * taxPercent) / 100);
      const scaledFood = round2(foodDeduction * factor);
      const scaledUnpaidLeave = round2(unpaidLeaveDeduction * factor);
      const scaledFines = round2(input.fines * factor);
      const scaledTaxable = round2(input.deductionTaxable * factor);
      const scaledNonTaxable = round2(input.deductionNonTaxable * factor);
      const scaledLoan = round2(input.loanDeduction * factor);
      const scaledAdvance = round2(input.advanceDeduction * factor);
      totalDeductions = round2(
        taxDeduction +
          scaledFood +
          scaledUnpaidLeave +
          scaledFines +
          scaledTaxable +
          scaledNonTaxable +
          scaledLoan +
          scaledAdvance,
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
