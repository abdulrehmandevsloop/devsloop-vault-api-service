import { BadRequestException } from '@nestjs/common';
import { HalfDayPeriod, LeaveType } from '@prisma/client';

export interface LeaveCalculation {
  daysConsumed: number;
  deductedFromCasual: boolean;
  deductedFromSick: boolean;
  isWfh: boolean;
  isMaternity: boolean;
}

/**
 * Compute how many days a leave request consumes and which balance it affects.
 * Calendar days are used (weekends not excluded per company policy).
 */
export function calculateLeaveDays(
  leaveType: LeaveType,
  startDate: Date,
  endDate: Date,
  halfDayPeriod?: HalfDayPeriod,
): LeaveCalculation {
  switch (leaveType) {
    case LeaveType.HALF_DAY:
      if (!halfDayPeriod) {
        throw new BadRequestException('halfDayPeriod is required for HALF_DAY leave type');
      }
      return {
        daysConsumed: 0.5,
        deductedFromCasual: true,
        deductedFromSick: false,
        isWfh: false,
        isMaternity: false,
      };

    case LeaveType.WFH:
      return {
        daysConsumed: countCalendarDays(startDate, endDate),
        deductedFromCasual: false,
        deductedFromSick: false,
        isWfh: true,
        isMaternity: false,
      };

    case LeaveType.SICK:
      return {
        daysConsumed: countCalendarDays(startDate, endDate),
        deductedFromCasual: false,
        deductedFromSick: true,
        isWfh: false,
        isMaternity: false,
      };

    case LeaveType.MATERNITY:
      return {
        daysConsumed: countCalendarDays(startDate, endDate),
        deductedFromCasual: false,
        deductedFromSick: false,
        isWfh: false,
        isMaternity: true,
      };

    case LeaveType.CASUAL:
    case LeaveType.WEDDING:
    case LeaveType.UMRAH_HAJJ:
    case LeaveType.OTHER:
      return {
        daysConsumed: countCalendarDays(startDate, endDate),
        deductedFromCasual: true,
        deductedFromSick: false,
        isWfh: false,
        isMaternity: false,
      };

    default: {
      const _exhaustive: never = leaveType;
      throw new BadRequestException('Unknown leave type');
    }
  }
}

/**
 * Count inclusive calendar days between two dates.
 */
export function countCalendarDays(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((end.getTime() - start.getTime()) / msPerDay) + 1;
}

/**
 * Compute pro-rata casual leave quota for a given year based on joining date.
 * Full year = 10 days. Rounded to nearest 0.5.
 */
export function computeProRataCasualQuota(joiningDate: Date, year: number): number {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);

  if (joiningDate > yearEnd) return 0;

  const effectiveStart = joiningDate > yearStart ? joiningDate : yearStart;
  const monthsRemaining = 12 - effectiveStart.getMonth();
  const proRata = (monthsRemaining / 12) * 10;
  return Math.round(proRata * 2) / 2;
}

/**
 * Compute pro-rata sick leave quota for a given year based on joining date.
 * Full year = 5 days. Rounded to nearest 0.5.
 */
export function computeProRataSickQuota(joiningDate: Date, year: number): number {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);

  if (joiningDate > yearEnd) return 0;

  const effectiveStart = joiningDate > yearStart ? joiningDate : yearStart;
  const monthsRemaining = 12 - effectiveStart.getMonth();
  const proRata = (monthsRemaining / 12) * 5;
  return Math.round(proRata * 2) / 2;
}
