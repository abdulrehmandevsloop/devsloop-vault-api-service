import { EmployeeStatus } from '@prisma/client';
import { countWeekdaysInUtcMonth, PayrollCalculationService } from './payroll-calculation.service';

describe('countWeekdaysInUtcMonth', () => {
  it('counts Mon–Fri in March 2026', () => {
    expect(countWeekdaysInUtcMonth('2026-03')).toBe(22);
  });

  it('returns 0 for invalid month', () => {
    expect(countWeekdaysInUtcMonth('2026-13')).toBe(0);
  });
});

describe('PayrollCalculationService', () => {
  const svc = new PayrollCalculationService();

  const baseInput = {
    baseSalaryMonthly: 30000,
    rentalAllowanceMonthly: 0,
    commuteAllowanceMonthly: 0,
    standardWorkingDays: 22,
    extraWorkingDays: 0,
    pendingWorkingDays: null as number | null,
    performanceBonus: 0,
    reimbursementManual: 0,
    reimbursementFromHr: 0,
    deductionTaxable: 0,
    deductionNonTaxable: 0,
    fines: 0,
    loanDeduction: 0,
    advanceDeduction: 0,
    lunchRatePerDay: 200,
    defaultTaxPercent: 10,
    taxPercentOverride: null as number | null,
  };

  it('deactivated yields zero net', () => {
    const r = svc.calculateLine('2026-03', {
      ...baseInput,
      employeeStatus: EmployeeStatus.DEACTIVATED,
    });
    expect(r.netSalary).toBe(0);
    expect(r.grossSalary).toBe(0);
  });

  it('active: gross includes basic pro-rated and lunch deducted', () => {
    const r = svc.calculateLine('2026-03', {
      ...baseInput,
      employeeStatus: EmployeeStatus.ACTIVE,
    });
    expect(r.basicProRated).toBe(22000);
    expect(r.foodDeduction).toBe(4400);
    expect(r.grossSalary).toBe(22000);
    expect(r.taxDeduction).toBe(2200);
    expect(r.netSalary).toBe(15400);
  });

  it('hold matches active calculation', () => {
    const a = svc.calculateLine('2026-03', {
      ...baseInput,
      employeeStatus: EmployeeStatus.ACTIVE,
    });
    const h = svc.calculateLine('2026-03', {
      ...baseInput,
      employeeStatus: EmployeeStatus.HOLD,
    });
    expect(h).toEqual(a);
  });

  it('freeze prorates with pending days', () => {
    const r = svc.calculateLine('2026-03', {
      ...baseInput,
      employeeStatus: EmployeeStatus.FREEZE,
      pendingWorkingDays: 11,
    });
    expect(r.netSalary).toBeLessThan(15400);
    expect(r.netSalary).toBeGreaterThan(0);
  });
});
